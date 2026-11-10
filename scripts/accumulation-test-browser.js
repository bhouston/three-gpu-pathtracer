import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BlendMaterial } from '../src/materials/fullscreen/BlendMaterial.js';
import { getAccumulationWeight } from '../src/utils/accumulationUtils.js';
import { WebGLPathTracer } from '../src/core/WebGLPathTracer.js';

window.runAccumulationTests = async () => {

	const renderer = new THREE.WebGLRenderer( { canvas: document.querySelector( 'canvas' ), preserveDrawingBuffer: true } );
	renderer.setSize( 384, 128 );
	const gl = renderer.getContext();
	const debug = gl.getExtension( 'WEBGL_debug_renderer_info' );
	const device = debug && gl.getParameter( debug.UNMASKED_RENDERER_WEBGL );
	if ( ! device || /swiftshader|llvmpipe|lavapipe|software|basic render/i.test( device ) ) {

		throw new Error( `Hardware GPU required; got ${ device }` );

	}

	const failures = [];
	const check = ( condition, message ) => {

		if ( ! condition && ! failures.includes( message ) ) failures.push( message );

	};

	const results = { device, failures, synthetic: [], sums: [], scene: [] };
	const size = 64;
	const target = type => new THREE.WebGLRenderTarget( size, size, { type, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter } );
	const sample = target( THREE.FloatType );
	const generate = new FullScreenQuad( new THREE.ShaderMaterial( {
		uniforms: { sampleIndex: { value: 0 }, alpha: { value: 1 } },
		vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
		fragmentShader: `varying vec2 vUv; uniform float sampleIndex; uniform float alpha;
		void main() { float noise = sin(sampleIndex * 2.39996323 + vUv.y * 13.0) * 0.002;
		gl_FragColor = vec4(vec3(0.05 + vUv.x * 0.9 + noise), alpha); }`,
	} ) );
	const blend = new FullScreenQuad( new BlendMaterial() );
	const copy = new FullScreenQuad( new THREE.ShaderMaterial( {
		uniforms: { map: { value: null } },
		vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
		fragmentShader: 'varying vec2 vUv;uniform sampler2D map;void main(){gl_FragColor=texture2D(map,vUv);}',
	} ) );
	const read = rt => {

		// Read half textures through a float target, so no CPU conversion changes rounding.
		const staging = target( THREE.FloatType );
		copy.material.uniforms.map.value = rt.texture;
		renderer.setRenderTarget( staging ); copy.render( renderer );
		const data = new Float32Array( size * size * 4 );
		renderer.readRenderTargetPixels( staging, 0, 0, size, size, data );
		staging.dispose();
		return data;

	};

	const error = ( data, reference ) => {

		let squared = 0;
		for ( let i = 0; i < data.length; i ++ ) {

			check( Number.isFinite( data[ i ] ), 'Non-finite output' );
			squared += ( data[ i ] - reference[ i ] ) ** 2;

		}

		return Math.sqrt( squared / data.length );

	};

	for ( const alpha of [ 1, 0.35 ] ) {

		const refs = new Map();
		for ( const mode of [ 'float', 'half', 'half-jitter' ] ) {

			let previous = target( mode === 'float' ? THREE.FloatType : THREE.HalfFloatType );
			let next = previous.clone();
			renderer.setRenderTarget( previous ); renderer.setClearColor( 0, 0 ); renderer.clear();
			generate.material.uniforms.alpha.value = alpha;
			for ( let n = 1; n <= 4096; n ++ ) {

				generate.material.uniforms.sampleIndex.value = n;
				renderer.setRenderTarget( sample ); generate.render( renderer );
				blend.material.target1 = previous.texture;
				blend.material.target2 = sample.texture;
				blend.material.opacity = mode === 'half-jitter' ? getAccumulationWeight( n ) : 1 / n;
				renderer.setRenderTarget( next ); blend.render( renderer );
				[ previous, next ] = [ next, previous ];
				if ( [ 64, 256, 1024, 4096 ].includes( n ) ) {

					const data = read( previous );
					if ( mode === 'float' ) refs.set( n, data );
					results.synthetic.push( { alpha, mode, samples: n, rmse: error( data, refs.get( n ) ) } );

				}

			}

			previous.dispose(); next.dispose();

		}

	}

	// Isolate the linked technique: weighted sums with cumulative weight in alpha.
	// This cannot replace the tracer's representation directly: its alpha is coverage.
	const sumQuad = new FullScreenQuad( new THREE.ShaderMaterial( {
		uniforms: { previous: { value: null }, sampleTexture: { value: sample.texture }, weight: { value: 1 } },
		vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
		fragmentShader: `varying vec2 vUv;uniform sampler2D previous;uniform sampler2D sampleTexture;uniform float weight;
		void main(){gl_FragColor=texture2D(previous,vUv)+vec4(texture2D(sampleTexture,vUv).rgb*weight,weight);}`,
	} ) );
	const sumRefs = new Map();
	generate.material.uniforms.alpha.value = 1;
	for ( const mode of [ 'float', 'half', 'half-halton' ] ) {

		let previous = target( mode === 'float' ? THREE.FloatType : THREE.HalfFloatType );
		let next = previous.clone();
		renderer.setRenderTarget( previous ); renderer.clear();
		for ( let n = 1; n <= 1024; n ++ ) {

			generate.material.uniforms.sampleIndex.value = n;
			renderer.setRenderTarget( sample ); generate.render( renderer );
			let index = n, halton = 0, digit = 0.5;
			while ( index ) {

				halton += ( index % 2 ) * digit; index = Math.floor( index / 2 ); digit *= 0.5;

			}

			sumQuad.material.uniforms.previous.value = previous.texture;
			sumQuad.material.uniforms.weight.value = mode === 'half-halton' ? 1 + ( 2 * halton - 1 ) * n / 2048 : 1;
			renderer.setRenderTarget( next ); sumQuad.render( renderer );
			[ previous, next ] = [ next, previous ];
			if ( [ 64, 256, 1024 ].includes( n ) ) {

				const data = read( previous );
				for ( let i = 0; i < data.length; i += 4 ) {

					for ( let channel = 0; channel < 3; channel ++ ) data[ i + channel ] /= data[ i + 3 ];
					data[ i + 3 ] = 1;

				}

				if ( mode === 'float' ) sumRefs.set( n, data );
				results.sums.push( { mode, samples: n, rmse: error( data, sumRefs.get( n ) ) } );

			}

		}

		previous.dispose(); next.dispose();

	}

	sumQuad.dispose();

	// End-to-end path tracing with the same stable ray samples in all modes.
	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0.1, 0.2, 0.3 );
	scene.add( new THREE.Mesh( new THREE.SphereGeometry( 0.7, 24, 16 ), new THREE.MeshStandardMaterial( { color: 0xc08040, roughness: 0.45 } ) ) );
	const plane = new THREE.Mesh( new THREE.PlaneGeometry( 8, 8 ), new THREE.MeshStandardMaterial( { color: 0xcccccc } ) );
	plane.rotation.x = - Math.PI / 2; plane.position.y = - 0.7; scene.add( plane );
	const light = new THREE.DirectionalLight( 0xffffff, 3 ); light.position.set( 1, 3, 2 ); scene.add( light );
	const camera = new THREE.PerspectiveCamera( 45, 1, 0.1, 100 ); camera.position.set( 2, 1.4, 3 ); camera.lookAt( 0, 0, 0 ); camera.updateMatrixWorld();
	const tracer = new WebGLPathTracer( renderer );
	tracer.setScene( scene, camera );
	tracer.stableNoise = true; tracer.tiles.set( 1, 1 ); tracer.bounces = 3;
	tracer._pathTracer.setSize( size, size );
	// Initialize dimensions before resetting, so the first run consumes no extra RNG samples.
	tracer._pathTracer.material.stratifiedTexture.init( 20, tracer.bounces + tracer.transmissiveBounces + 5 );
	const refs = new Map();
	for ( const mode of [ 'float', 'half', 'half-jitter' ] ) {

		tracer.halfFloatAccumulation = mode !== 'float';
		tracer._pathTracer.reset();
		// Baseline half uses identical render targets but overrides just the blend weight.
		const originalRender = renderer.render.bind( renderer );
		if ( mode === 'half' ) renderer.render = ( ...args ) => {

			tracer._pathTracer.material.opacity = 1 / ( tracer.samples + 1 );
			return originalRender( ...args );

		};

		for ( let n = 1; n <= 1024; n ++ ) {

			tracer._pathTracer.update();
			while ( tracer.isCompiling ) await new Promise( resolve => setTimeout( resolve, 10 ) );
			if ( tracer.samples < n ) tracer._pathTracer.update();
			if ( [ 64, 256, 1024 ].includes( n ) ) {

				const data = read( tracer.target );
				if ( mode === 'float' ) refs.set( n, data );
				results.scene.push( { mode, samples: n, rmse: error( data, refs.get( n ) ) } );

			}

		}

		renderer.render = originalRender;
		renderer.setRenderTarget( null );
		renderer.setViewport( [ 'float', 'half', 'half-jitter' ].indexOf( mode ) * 128, 0, 128, 128 );
		copy.material.uniforms.map.value = tracer.target.texture;
		const oldClear = renderer.autoClear; renderer.autoClear = false; copy.render( renderer ); renderer.autoClear = oldClear;

	}

	tracer.halfFloatAccumulation = false;
	check( tracer.samples === 0 && tracer.target.texture.type === THREE.FloatType, 'Precision toggle must reset and restore float' );
	tracer.dispose(); sample.dispose(); generate.dispose(); blend.dispose(); copy.dispose();
	tracer._lowResPathTracer.dispose();
	check( gl.getError() === gl.NO_ERROR, 'WebGL error' );
	return results;

};
