import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAccumulationWeight } from '../src/utils/accumulationUtils.js';

test( 'paired weights normalize a weighted mean exactly without storing cumulative weight', () => {

	let mean = 0;
	let sum = 0;
	let total = 0;
	for ( let n = 1; n <= 8192; n ++ ) {

		const pair = Math.floor( ( n - 1 ) / 2 ) + 1;
		const digits = pair.toString( 2 ).split( '' ).reverse();
		const halton = digits.reduce( ( value, digit, i ) => value + Number( digit ) * 2 ** ( - i - 1 ), 0 );
		const amplitude = Math.min( ( 2 * pair - 1 ) / 2048, 0.5 ) * ( 2 * halton - 1 );
		const weight = n % 2 ? 1 + amplitude : 1 - amplitude;
		const value = Math.sin( n * 0.71 ) + 2;
		sum += value * weight;
		total += weight;
		const factor = getAccumulationWeight( n );
		assert.ok( factor > 0 && factor <= 1 );
		mean = mean * ( 1 - factor ) + value * factor;
		assert.ok( Math.abs( mean - sum / total ) < 1e-12 );
		if ( n % 2 === 0 ) assert.equal( total, n );

	}

} );

test( 'normalized weights preserve constant color and coverage', () => {

	let alpha = 0;
	let premultiplied = 0;
	for ( let n = 1; n <= 4096; n ++ ) {

		const factor = getAccumulationWeight( n );
		alpha = alpha * ( 1 - factor ) + 0.35 * factor;
		premultiplied = premultiplied * ( 1 - factor ) + 2.5 * 0.35 * factor;
		assert.ok( Math.abs( alpha - 0.35 ) < 1e-12 );
		assert.ok( Math.abs( premultiplied / alpha - 2.5 ) < 1e-12 );

	}

} );
