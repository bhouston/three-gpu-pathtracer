import * as THREE from 'three/webgpu';
import { WebGPUPathTracer } from '../src/webgpu/index.js';
import { createPrecisionScene } from './precision-scenes.js';

function check( condition, message ) {

	if ( ! condition ) throw new Error( message );

}

function displayValue( value, exposure ) {

	value = Math.max( 0, value * exposure );
	value /= 1 + value;
	return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** ( 1 / 2.4 ) - 0.055;

}

export function compareImages( half, full, exposure = 1 ) {

	let squared = 0, referenceSquared = 0, displaySquared = 0, signed = 0, referenceSum = 0, nonfinite = 0;
	const absolute = [];
	for ( let i = 0; i < full.length; i ++ ) {

		if ( i % 4 === 3 ) continue;
		if ( ! Number.isFinite( half[ i ] ) || ! Number.isFinite( full[ i ] ) ) {

			nonfinite ++; continue;

		}

		const diff = half[ i ] - full[ i ];
		squared += diff * diff;
		referenceSquared += full[ i ] * full[ i ];
		displaySquared += ( displayValue( half[ i ], exposure ) - displayValue( full[ i ], exposure ) ) ** 2;
		signed += diff; referenceSum += full[ i ]; absolute.push( Math.abs( diff ) );

	}

	absolute.sort( ( a, b ) => a - b );
	return {
		rgbRMSE: Math.sqrt( squared / absolute.length ),
		normalizedRMSE: Math.sqrt( squared / referenceSquared ),
		displayRMSE: Math.sqrt( displaySquared / absolute.length ),
		meanBias: signed / referenceSum,
		p99AbsoluteError: absolute[ Math.floor( absolute.length * 0.99 ) ],
		maxAbsoluteError: absolute[ absolute.length - 1 ], nonfinite,
	};

}

function makeImages( half, full, width, height, exposure, title ) {

	const make = ( data, difference = false ) => {

		const canvas = document.createElement( 'canvas' ); canvas.width = width; canvas.height = height;
		const context = canvas.getContext( '2d' );
		const pixels = context.createImageData( width, height );
		for ( let i = 0; i < data.length; i ++ ) {

			pixels.data[ i ] = i % 4 === 3 ? 255 : 255 * ( difference ?
				Math.min( 1, Math.abs( displayValue( half[ i ], exposure ) - displayValue( full[ i ], exposure ) ) * 16 ) : displayValue( data[ i ], exposure ) );

		}

		context.putImageData( pixels, 0, 0 ); return canvas;

	};

	const fullCanvas = make( full ), halfCanvas = make( half ), diffCanvas = make( half, true );
	let worst = 0, worstIndex = 0;
	for ( let i = 0; i < full.length; i += 4 ) {

		let difference = 0;
		for ( let c = 0; c < 3; c ++ ) difference += Math.abs( displayValue( half[ i + c ], exposure ) - displayValue( full[ i + c ], exposure ) );
		if ( difference > worst ) {

			worst = difference; worstIndex = i / 4;

		}

	}

	const crop = 40;
	const cropX = Math.max( 0, Math.min( width - crop, worstIndex % width - crop / 2 ) );
	const cropY = Math.max( 0, Math.min( height - crop, Math.floor( worstIndex / width ) - crop / 2 ) );
	const panelWidth = width * 2, imageHeight = height * 2, cropHeight = 160;
	const composite = document.createElement( 'canvas' ); composite.width = panelWidth * 3; composite.height = imageHeight + cropHeight + 92;
	const context = composite.getContext( '2d' );
	context.fillStyle = '#181818'; context.fillRect( 0, 0, composite.width, composite.height );
	context.fillStyle = '#ffffff'; context.font = '16px sans-serif'; context.fillText( title, 12, 22 );
	[ fullCanvas, halfCanvas, diffCanvas ].forEach( ( canvas, index ) => {

		const x = panelWidth * index;
		context.fillText( [ 'Float32 running average', 'Float16 running average', 'Display difference ×16' ][ index ], x + 12, 47 );
		context.imageSmoothingEnabled = false;
		context.drawImage( canvas, x, 56, panelWidth, imageHeight );
		context.fillText( `Detail crop (${ cropX }, ${ cropY })`, x + 12, imageHeight + 78 );
		context.drawImage( canvas, cropX, cropY, crop, crop, x + 12, imageHeight + 86, cropHeight, cropHeight );

	} );
	return { float32: fullCanvas.toDataURL(), float16: halfCanvas.toDataURL(), difference: diffCanvas.toDataURL(), comparison: composite.toDataURL(), crop: { x: cropX, y: cropY, size: crop } };

}

export async function createPrecisionExperiment() {

	const adapter = await navigator.gpu?.requestAdapter( { powerPreference: 'high-performance' } );
	check( adapter, 'Hardware WebGPU unavailable' );
	const info = adapter.info;
	const hardware = { vendor: info.vendor, architecture: info.architecture, description: info.description, fallback: adapter.isFallbackAdapter || false };
	const description = JSON.stringify( hardware );
	check( ! hardware.fallback && /nvidia|amd|intel|apple/i.test( description ) && ! /swiftshader|lavapipe|llvmpipe|software|basic render/i.test( description ), `Physical GPU required: ${ description }` );
	const device = await adapter.requestDevice( { requiredFeatures: [ ...adapter.features ] } );
	const errors = [];
	device.addEventListener( 'uncapturederror', event => errors.push( event.error.message ) );
	const renderer = new THREE.WebGPURenderer( { device, antialias: false } );
	await renderer.init();
	check( renderer.backend.isWebGPUBackend, 'WebGPU fallback rejected' );
	renderer.setPixelRatio( 1 ); renderer.toneMapping = THREE.ReinhardToneMapping;
	let tracer, currentScene;
	async function setup( sceneId, width, height, mega = true ) {

		await device.queue.onSubmittedWorkDone();
		tracer?.dispose(); currentScene?.dispose();
		renderer.setSize( width, height );
		currentScene = createPrecisionScene( sceneId, width / height );
		renderer.toneMappingExposure = currentScene.exposure;
		tracer = new WebGPUPathTracer( renderer );
		tracer.synchronizeRenderSize = false; tracer.dynamicLowRes = false; tracer.adaptiveDynamicRes = false;
		tracer.adaptiveFrameBudget = false; tracer.renderDelay = 0; tracer.minSamples = 0; tracer.fadeDuration = 0;
		tracer.asyncCompile = false; tracer.stableNoise = true; tracer.maxBounces = 4;
		tracer.frameBudget = width * height; tracer.setSize( width, height ); tracer.setScene( currentScene.scene, currentScene.camera );
		tracer.useMegakernel( mega ); tracer.maxBounces = 4; tracer.frameBudget = width * height;
		tracer.renderToCanvas = true;
		// The backend's first resize increments its RNG seed. Do it before stable reset,
		// otherwise the first precision uses seed 1 and subsequent precisions use seed 0.
		tracer._pathTracer.setSize( width, height );
		tracer.reset();

	}

	async function read() {

		await device.queue.onSubmittedWorkDone();
		const target = tracer.target;
		const buffer = await renderer.backend.copyTextureToBuffer( target, 0, 0, target.image.width, target.image.height );
		return target.type === THREE.HalfFloatType ? Float32Array.from( buffer, value => THREE.DataUtils.fromHalfFloat( value ) ) : Float32Array.from( buffer );

	}

	async function quality( sceneId, width = 192, height = 128, checkpoints = [ 64, 256, 1024, 4096 ] ) {

		await setup( sceneId, width, height );
		const captures = { float32: new Map(), float16: new Map() };
		for ( const half of [ false, true ] ) {

			tracer.halfFloatAccumulation = half; tracer.reset(); tracer.maxSamples = 0;
			for ( let n = 1; n <= Math.max( ...checkpoints ); n ++ ) {

				tracer.renderSample();
				if ( n % 32 === 0 ) await device.queue.onSubmittedWorkDone();
				if ( checkpoints.includes( n ) ) {

					const counts = await tracer.getSampleCountsAsync();
					check( counts.min === n && counts.avg === n, `Incomplete sample frame at ${ n }: ${ JSON.stringify( counts ) }` );
					captures[ half ? 'float16' : 'float32' ].set( n, await read() );
					console.log( `${ sceneId } ${ half ? 'float16' : 'float32' }: ${ n } GPU-completed samples` );

				}

			}

		}

		check( errors.length === 0, errors.join( '\n' ) );
		const last = Math.max( ...checkpoints ), reference = captures.float32.get( last );
		const repeatCount = checkpoints.includes( 256 ) ? 256 : checkpoints[ 0 ];
		tracer.halfFloatAccumulation = false; tracer.reset();
		for ( let n = 1; n <= repeatCount; n ++ ) {

			tracer.renderSample();
			if ( n % 32 === 0 ) await device.queue.onSubmittedWorkDone();

		}

		const repeatedError = compareImages( await read(), captures.float32.get( repeatCount ) );
		check( repeatedError.maxAbsoluteError === 0, `Ray samples changed between resets: ${ repeatedError.maxAbsoluteError }` );
		const rows = checkpoints.map( n => ( {
			samples: n, ...compareImages( captures.float16.get( n ), captures.float32.get( n ), currentScene.exposure ),
			float32VersusFinal: compareImages( captures.float32.get( n ), reference, currentScene.exposure ).rgbRMSE,
			float16VersusFinal: compareImages( captures.float16.get( n ), reference, currentScene.exposure ).rgbRMSE,
		} ) );
		let changedFull = 0, frozenHalf = 0;
		if ( captures.float32.has( 1024 ) && last > 1024 ) {

			for ( let i = 0; i < reference.length; i ++ ) {

				if ( i % 4 !== 3 && Math.abs( reference[ i ] - captures.float32.get( 1024 )[ i ] ) > 1e-5 ) {

					changedFull ++;
					if ( captures.float16.get( last )[ i ] === captures.float16.get( 1024 )[ i ] ) frozenHalf ++;

				}

			}

		}

		return {
			sceneId, backend: 'mega', width, height, rows, repeatFloat32MaxError: repeatedError.maxAbsoluteError,
			stagnation: { interval: [ 1024, last ], floatChangedChannels: changedFull, halfUnchangedAmongThose: frozenHalf, fraction: frozenHalf / changedFull },
			images: makeImages( captures.float16.get( last ), reference, width, height, currentScene.exposure, `${ sceneId } · ${ last } samples · ${ width }×${ height } · no weight jitter` ),
		};

	}

	async function benchmark( sceneId, backend = 'mega', width = 768, height = 512, seconds = 5 ) {

		await setup( sceneId, width, height, backend === 'mega' );
		const trials = [];
		// ABBA reduces simple order/temperature bias; each implementation runs on its own.
		for ( const half of [ false, true, true, false ] ) {

			tracer.halfFloatAccumulation = half; tracer.maxSamples = 0; tracer.reset();
			// Warm pipelines, storage and caches before starting any throughput measurement.
			const warmStart = performance.now();
			do {

				for ( let i = 0; i < 16; i ++ ) tracer.renderSample();
				await device.queue.onSubmittedWorkDone();

			} while ( performance.now() - warmStart < 1000 );

			const before = await tracer.getSampleCountsAsync();
			await device.queue.onSubmittedWorkDone();
			const start = performance.now();
			let updates = 0, elapsed;
			do {

				for ( let i = 0; i < 16; i ++ ) {

					tracer.renderSample(); updates ++;

				}

				// All updates in this batch must complete on the GPU before they can count.
				await device.queue.onSubmittedWorkDone();
				elapsed = ( performance.now() - start ) / 1000;

			} while ( elapsed < seconds );

			const after = await tracer.getSampleCountsAsync();
			const completedSampleFrames = after.avg - before.avg;
			check( completedSampleFrames > 0 && errors.length === 0, errors.join( '\n' ) || 'No samples completed' );
			trials.push( { precision: half ? 'float16' : 'float32', seconds: elapsed, completedUpdates: updates, completedSampleFrames, sampleFramesPerSecond: completedSampleFrames / elapsed, updatesPerSecond: updates / elapsed } );
			console.log( `${ sceneId } ${ backend } ${ half ? 'float16' : 'float32' }: ${ completedSampleFrames.toFixed( 2 ) } GPU-completed sample-equivalent frames in ${ elapsed.toFixed( 2 ) }s` );

		}

		return { sceneId, backend, width, height, trials };

	}

	async function close() {

		await device.queue.onSubmittedWorkDone(); tracer?.dispose(); currentScene?.dispose(); renderer.dispose(); device.destroy();

	}

	return { hardware, quality, benchmark, close };

}
