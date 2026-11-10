import * as THREE from 'three/webgpu';

export const sceneIds = [ 'studio', 'cornell', 'glossy', 'gradient' ];

export function createPrecisionScene( id, aspect = 1.5 ) {

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera( 42, aspect, 0.1, 100 );
	const resources = [];
	const mesh = ( geometry, material, position = [ 0, 0, 0 ] ) => {

		resources.push( geometry, material );
		const object = new THREE.Mesh( geometry, material );
		object.position.set( ...position );
		scene.add( object );
		return object;

	};

	const standard = options => new THREE.MeshStandardMaterial( options );
	const sphere = ( x, radius, options ) => mesh( new THREE.SphereGeometry( radius, 32, 20 ), standard( options ), [ x, radius, 0 ] );
	const floor = () => {

		const object = mesh( new THREE.PlaneGeometry( 20, 20 ), standard( { color: 0xaaaaaa, roughness: 0.8 } ) );
		object.rotation.x = - Math.PI / 2;

	};

	let exposure = 1;
	if ( id === 'studio' ) {

		scene.background = new THREE.Color( 0.16, 0.22, 0.32 );
		floor();
		sphere( - 0.8, 0.7, { color: 0xc07a32, roughness: 0.45 } );
		sphere( 0.85, 0.55, { color: 0x6095c8, roughness: 0.7 } );
		const light = new THREE.RectAreaLight( 0xffffff, 9, 2, 2 );
		light.position.set( 1, 4, 2 ); light.lookAt( 0, 0, 0 ); scene.add( light );
		camera.position.set( 3.2, 2.1, 5 ); camera.lookAt( 0, 0.6, 0 );

	} else if ( id === 'cornell' ) {

		scene.background = new THREE.Color( 0 );
		const panel = ( color, position, rotation ) => {

			const object = mesh( new THREE.PlaneGeometry( 4, 4 ), standard( { color, side: THREE.DoubleSide, roughness: 1 } ), position );
			object.rotation.set( ...rotation );

		};

		panel( 0xbababa, [ 0, 0, 0 ], [ - Math.PI / 2, 0, 0 ] );
		panel( 0xbababa, [ 0, 4, 0 ], [ Math.PI / 2, 0, 0 ] );
		panel( 0xbababa, [ 0, 2, - 2 ], [ 0, 0, 0 ] );
		panel( 0xbf3020, [ - 2, 2, 0 ], [ 0, Math.PI / 2, 0 ] );
		panel( 0x309048, [ 2, 2, 0 ], [ 0, - Math.PI / 2, 0 ] );
		mesh( new THREE.BoxGeometry( 1.1, 1.6, 1.1 ), standard( { color: 0xcccccc, roughness: 0.9 } ), [ - 0.8, 0.8, - 0.5 ] ).rotation.y = 0.35;
		sphere( 0.85, 0.7, { color: 0xc0c0c0, roughness: 0.35 } );
		const light = new THREE.RectAreaLight( 0xffffff, 12, 1.2, 1.2 );
		light.position.set( 0, 3.95, - 0.4 ); light.lookAt( 0, 0, - 0.4 ); scene.add( light );
		camera.position.set( 0, 2, 6.7 ); camera.lookAt( 0, 1.9, - 0.3 );

	} else if ( id === 'glossy' ) {

		scene.background = new THREE.Color( 0.002, 0.003, 0.005 );
		floor();
		sphere( - 0.85, 0.7, { color: 0xc0c0c0, metalness: 1, roughness: 0.09 } );
		sphere( 0.85, 0.7, { color: 0xd08035, metalness: 1, roughness: 0.32 } );
		const light = new THREE.RectAreaLight( 0xffffff, 180, 0.3, 2.5 );
		light.position.set( - 1.5, 3, 1.5 ); light.lookAt( 0, 0.5, 0 ); scene.add( light );
		const fill = new THREE.RectAreaLight( 0x7090ff, 6, 2, 2 );
		fill.position.set( 3, 2, - 1 ); fill.lookAt( 0, 0.5, 0 ); scene.add( fill );
		camera.position.set( 2.7, 1.8, 5.3 ); camera.lookAt( 0, 0.65, 0 );
		exposure = 0.5;

	} else if ( id === 'gradient' ) {

		// An emissive radiance ramp with dark and bright low-contrast detail.
		// Camera-ray jitter is retained; accumulation weights are ordinary 1/n.
		const width = 512, height = 128;
		const data = new Float32Array( width * height * 4 );
		for ( let y = 0; y < height; y ++ ) {

			for ( let x = 0; x < width; x ++ ) {

				const ramp = 0.05 + 0.95 * x / ( width - 1 );
				const detail = 0.002 * Math.sin( x * 0.15 ) * Math.sin( y * 0.2 );
				const value = y < height / 2 ? ramp + detail : 8 + ramp * 0.02 + detail;
				const index = ( y * width + x ) * 4;
				data.set( [ value, value * 0.85, value * 0.65, 1 ], index );

			}

		}

		const texture = new THREE.DataTexture( data, width, height, THREE.RGBAFormat, THREE.FloatType );
		texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
		resources.push( texture );
		mesh( new THREE.PlaneGeometry( 12, 8 ), standard( { color: 0, emissive: 0xffffff, emissiveMap: texture } ) );
		camera.position.set( 0, 0, 5 ); camera.lookAt( 0, 0, 0 );

	} else {

		throw new Error( `Unknown scene ${ id }` );

	}

	camera.updateMatrixWorld();
	scene.updateMatrixWorld( true );
	return { scene, camera, exposure, dispose: () => resources.forEach( resource => resource.dispose() ) };

}
