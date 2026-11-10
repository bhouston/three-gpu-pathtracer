// Hardware-only quality experiment. No software rendering fallback is permitted.
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {

	const output = path.resolve( process.argv[ 2 ] || 'accumulation-results' );
	await fs.mkdir( output, { recursive: true } );
	const server = await createServer( { configFile: false, root: process.cwd(), server: { port: 0 } } );
	let browser;
	try {

		await server.listen();
		browser = await puppeteer.launch( {
			executablePath: process.env.CHROME_PATH || undefined,
			headless: true,
			args: [ '--disable-software-rasterizer', '--enable-unsafe-webgpu', '--disable-gpu-vsync', '--disable-frame-rate-limit' ],
		} );
		const page = await browser.newPage();
		await page.setViewport( { width: 410, height: 210 } );
		page.on( 'pageerror', error => console.error( error ) );
		page.on( 'console', message => console.log( message.text() ) );
		await page.goto( `${ server.resolvedUrls.local[ 0 ] }scripts/accumulation-test.html` );
		await page.waitForFunction( () => window.runAccumulationTests, { timeout: 60000 } );
		const result = await page.evaluate( () => window.runAccumulationTests() );
		await fs.writeFile( path.join( output, 'accumulation-results.json' ), JSON.stringify( result, null, 2 ) );
		await page.screenshot( { path: path.join( output, 'accumulation.png' ), fullPage: true } );
		console.log( JSON.stringify( result, null, 2 ) );
		if ( result.failures.length ) throw new Error( result.failures.join( '\n' ) );
		const webgpu = await page.evaluate( async () => {

			const { runWebGPUTests } = await import( '/scripts/accumulation-webgpu-test-browser.js' );
			return runWebGPUTests();

		} );
		await fs.writeFile( path.join( output, 'accumulation-webgpu-results.json' ), JSON.stringify( webgpu, null, 2 ) );
		console.log( JSON.stringify( webgpu, null, 2 ) );

	} finally {

		await browser?.close();
		await server.close();

	}

}

main().catch( error => {

	console.error( error );
	process.exitCode = 1;

} );
