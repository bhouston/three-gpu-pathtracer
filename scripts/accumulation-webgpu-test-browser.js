import { WebGPURenderer, Scene, PerspectiveCamera, Mesh, SphereGeometry, MeshStandardMaterial, Color, HalfFloatType, FloatType, DataUtils } from 'three/webgpu';
import { WebGPUPathTracer } from '../src/webgpu/index.js';

// Runs on the adapter explicitly passed to Three.js. Every image read waits for GPU completion.
export async function runWebGPUTests() {

	const results = { adapter: null, cases: [], failures: [] };
	const check = ( value, message ) => {

		if ( ! value ) throw new Error( message );

	};

	const adapter = await navigator.gpu?.requestAdapter( { powerPreference: 'high-performance' } );
	check( adapter, 'Hardware WebGPU adapter unavailable' );
	const info = adapter.info;
	results.adapter = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: adapter.isFallbackAdapter };
	const description = Object.values( results.adapter ).join( ' ' );
	check( ! adapter.isFallbackAdapter && ! /swiftshader|llvmpipe|lavapipe|software|microsoft basic/i.test( description ), 'Software WebGPU adapter rejected: ' + description );
	check( /nvidia/i.test( description ), 'This experiment requires the physical NVIDIA adapter: ' + description );
	const device = await adapter.requestDevice( { requiredFeatures: [ ...adapter.features ] } );
	const errors = [];
	device.addEventListener( 'uncapturederror', event => errors.push( event.error.message ) );
	const renderer = new WebGPURenderer( { device, antialias: false } );
	let tracer;
	const geometry = new SphereGeometry( 0.65, 24, 16 );
	const material = new MeshStandardMaterial( { color: 0, emissive: new Color( 1, 0.3, 0.1 ) } );
	try {

		await renderer.init();
		check( renderer.backend.isWebGPUBackend, 'Renderer did not initialize WebGPU' );
		renderer.setSize( 24, 24 );
		const scene = new Scene();
		scene.add( new Mesh( geometry, material ) );
		const camera = new PerspectiveCamera( 45, 1, 0.1, 10 );
		camera.position.z = 3;
		camera.updateMatrixWorld();
		tracer = new WebGPUPathTracer( renderer );
		tracer.renderToCanvas = false;
		tracer.synchronizeRenderSize = false;
		tracer.dynamicLowRes = false;
		tracer.renderDelay = 0;
		tracer.minSamples = 0;
		tracer.adaptiveFrameBudget = false;
		tracer.stableNoise = true;
		tracer.frameBudget = 576;
		tracer.maxBounces = 2;
		tracer.setSize( 24, 24 );
		tracer.setScene( scene, camera );
		async function render( samples ) {

			tracer.maxSamples = samples;
			let counts;
			for ( let batch = 0; batch < 1024; batch ++ ) {

				for ( let i = 0; i < 8; i ++ ) tracer.renderSample();
				await device.queue.onSubmittedWorkDone();
				counts = await tracer.getSampleCountsAsync();
				if ( counts.min >= samples ) break;

			}

			check( counts.min === samples && counts.avg === samples && counts.max <= samples + 1, 'Sample convergence failed: ' + JSON.stringify( counts ) );
			const target = tracer.target;
			const raw = await renderer.backend.copyTextureToBuffer( target, 0, 0, target.image.width, target.image.height );
			await device.queue.onSubmittedWorkDone();
			const data = target.type === HalfFloatType ? Float32Array.from( raw, value => DataUtils.fromHalfFloat( value ) ) : raw;
			check( data.every( Number.isFinite ), 'Nonfinite readback' );
			const center = ( Math.floor( target.image.height / 2 ) * target.image.width + Math.floor( target.image.width / 2 ) ) * 4;
			check( Math.abs( data[ center + 3 ] - 1 ) < 0.002, 'Opaque center lost alpha coverage' );
			check( data[ 3 ] === 0, 'Transparent corner lost alpha coverage' );
			check( Math.abs( data[ center ] - 1 ) < 0.005, 'Constant emissive radiance changed' );
			check( errors.length === 0, errors.join( '\n' ) );
			const { min, max, avg } = counts;
			return { counts: { min, max, avg }, width: target.image.width, height: target.image.height, center: Array.from( data.slice( center, center + 4 ) ), cornerAlpha: data[ 3 ] };

		}

		for ( const megakernel of [ false, true ] ) {

			tracer.useMegakernel( megakernel );
			tracer.frameBudget = 576;
			for ( const half of [ false, true, false ] ) {

				tracer.halfFloatAccumulation = half;
				tracer.reset();
				await device.queue.onSubmittedWorkDone();
				const resetCounts = await tracer.getSampleCountsAsync();
				check( resetCounts.min === 0 && resetCounts.avg === 0, 'Reset did not clear sample statistics' );
				const countTarget = tracer._pathTracer.sampleCountTarget;
				const resetBuffer = await renderer.backend.copyTextureToBuffer( countTarget, 0, 0, countTarget.image.width, countTarget.image.height );
				check( resetBuffer.every( value => value === 0 ), 'Reset did not clear GPU sample counts' );
				const image = await render( 32 );
				check( tracer.target.type === ( half ? HalfFloatType : FloatType ), 'Incorrect output format' );
				results.cases.push( { backend: megakernel ? 'mega' : 'wavefront', half, ...image } );

			}

			tracer.halfFloatAccumulation = true;
			tracer.setSize( 32, 32 );
			results.cases.push( { backend: megakernel ? 'mega' : 'wavefront', half: true, resize: true, ...await render( 32 ) } );
			tracer.setSize( 24, 24 );

		}

		// Exercise the preview-to-full-resolution copy, which requires matching texture formats.
		tracer.halfFloatAccumulation = true;
		tracer.dynamicLowRes = true;
		tracer.renderDelay = 100000;
		tracer.minSamples = 1;
		tracer.reset();
		tracer.renderSample();
		await device.queue.onSubmittedWorkDone();
		tracer.renderDelay = 0;
		tracer.renderSample();
		await device.queue.onSubmittedWorkDone();
		check( tracer.lowResTarget.type === HalfFloatType, 'Preview texture format mismatch' );
		check( errors.length === 0, errors.join( '\n' ) );
		tracer.dynamicLowRes = false;
		tracer.minSamples = 0;
		results.cases.push( { backend: 'mega', half: true, previewTransition: true, ...await render( 32 ) } );

		tracer.halfFloatAccumulation = true;
		tracer.useMegakernel( false );
		check( tracer.halfFloatAccumulation, 'Backend switch lost precision setting' );
		results.cases.push( { backend: 'wavefront', half: true, switched: true, ...await render( 32 ) } );
		await device.queue.onSubmittedWorkDone();
		check( errors.length === 0, errors.join( '\n' ) );

	} catch ( error ) {

		results.failures.push( error.stack || error.message );

	} finally {

		await device.queue.onSubmittedWorkDone();
		tracer?.dispose();
		geometry.dispose();
		material.dispose();
		renderer.dispose();
		device.destroy();

	}

	return results;

}
