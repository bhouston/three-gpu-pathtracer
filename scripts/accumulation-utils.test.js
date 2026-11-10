import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareImages } from './precision-experiment-browser.js';

test( 'precision metrics exclude coverage and measure linear and display differences separately', () => {

	const full = new Float32Array( [ 1, 1, 1, 1, 1, 1, 1, 0 ] );
	const half = new Float32Array( [ 0.5, 0.5, 0.5, 0, 0.5, 0.5, 0.5, 1 ] );
	const result = compareImages( half, full );
	assert.equal( result.rgbRMSE, 0.5 );
	assert.equal( result.normalizedRMSE, 0.5 );
	assert.equal( result.meanBias, - 0.5 );
	assert.equal( result.p99AbsoluteError, 0.5 );
	assert.equal( result.maxAbsoluteError, 0.5 );
	assert.ok( result.displayRMSE > 0 && result.displayRMSE < result.rgbRMSE );
	assert.equal( result.nonfinite, 0 );

} );

test( 'precision metrics detect nonfinite output and identical images', () => {

	const full = new Float32Array( [ 1, 2, 3, 1 ] );
	assert.equal( compareImages( full, full ).rgbRMSE, 0 );
	assert.equal( compareImages( full, full ).displayRMSE, 0 );
	assert.equal( compareImages( new Float32Array( [ Infinity, 2, 3, 1 ] ), full ).nonfinite, 1 );

} );
