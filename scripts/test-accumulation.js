// Hardware-only accuracy and sustained-throughput experiments. No software fallback.
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sceneIds } from './precision-scenes.js';

async function main() {

	const output = path.resolve( process.argv[ 2 ] || 'accumulation-results' );
	const qualityOnly = process.argv.includes( '--quality-only' );
	const benchmarkOnly = process.argv.includes( '--benchmark-only' );
	const smokeOnly = process.argv.includes( '--smoke-only' );
	const selected = process.env.PRECISION_SCENES?.split( ',' ) || sceneIds;
	await fs.mkdir( output, { recursive: true } );
	const server = await createServer( { configFile: false, root: process.cwd(), server: { port: 0, hmr: false, watch: { ignored: [ '**/*' ] } } } );
	let browser;
	try {

		await server.listen();
		browser = await puppeteer.launch( {
			executablePath: process.env.CHROME_PATH || undefined,
			headless: true, protocolTimeout: 1200000,
			args: [ '--disable-software-rasterizer', '--enable-unsafe-webgpu', '--disable-gpu-vsync', '--disable-frame-rate-limit' ],
		} );
		const page = await browser.newPage();
		page.on( 'pageerror', error => console.error( error ) );
		page.on( 'console', message => console.log( message.text() ) );
		await page.goto( `${ server.resolvedUrls.local[ 0 ] }scripts/accumulation-test.html` );
		if ( ! qualityOnly && ! benchmarkOnly ) {

			const smoke = await page.evaluate( async () => {

				const { runWebGPUTests } = await import( '/scripts/accumulation-webgpu-test-browser.js' );
				return runWebGPUTests();

			} );
			await fs.writeFile( path.join( output, 'precision-smoke.json' ), JSON.stringify( smoke, null, 2 ) );
			if ( smoke.failures.length ) throw new Error( smoke.failures.join( '\n' ) );
			console.log( `Passed ${ smoke.cases.length } hardware smoke cases` );

		}

		if ( smokeOnly ) return;
		const hardware = await page.evaluate( async () => {

			const { createPrecisionExperiment } = await import( '/scripts/precision-experiment-browser.js' );
			window.precisionExperiment = await createPrecisionExperiment();
			return window.precisionExperiment.hardware;

		} );
		console.log( JSON.stringify( hardware ) );
		const quality = { hardware, scenes: [] }, throughput = { hardware, scenes: [] };
		for ( const sceneId of selected ) {

			if ( ! benchmarkOnly ) {

				console.log( `Starting quality: ${ sceneId }` );
				const result = await page.evaluate( id => window.precisionExperiment.quality( id ), sceneId );
				for ( const key of [ 'float32', 'float16', 'difference', 'comparison' ] ) {

					await fs.writeFile( path.join( output, `${ sceneId }-${ key }.png` ), Buffer.from( result.images[ key ].split( ',' )[ 1 ], 'base64' ) );

				}

				result.crop = result.images.crop; delete result.images;
				quality.scenes.push( result );
				await fs.writeFile( path.join( output, `${ sceneId }-quality.json` ), JSON.stringify( result, null, 2 ) );
				await fs.writeFile( path.join( output, 'precision-quality.json' ), JSON.stringify( quality, null, 2 ) );
				console.log( JSON.stringify( result ) );

			}

			if ( ! qualityOnly ) {

				for ( const backend of [ 'mega', 'wavefront' ] ) {

					console.log( `Starting throughput: ${ sceneId } ${ backend }` );
					const result = await page.evaluate( ( id, backend ) => window.precisionExperiment.benchmark( id, backend ), sceneId, backend );
					throughput.scenes.push( result );
					await fs.writeFile( path.join( output, `${ sceneId }-${ backend }-throughput.json` ), JSON.stringify( result, null, 2 ) );
					await fs.writeFile( path.join( output, 'precision-throughput.json' ), JSON.stringify( throughput, null, 2 ) );
					console.log( JSON.stringify( result ) );

				}

			}

		}

		await page.evaluate( () => window.precisionExperiment.close() );

	} finally {

		await browser?.close();
		await server.close();

	}

}

main().catch( error => {

	console.error( error );
	process.exitCode = 1;

} );
