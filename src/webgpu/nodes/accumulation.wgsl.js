import { wgslFn } from 'three/tsl';

// Matches getAccumulationWeight in utils/accumulationUtils.js. Alpha remains image coverage.
export const accumulationWeightFn = wgslFn( /* wgsl */`

	fn accumulationWeight( sampleCount: u32, halfFloat: u32 ) -> f32 {

		if ( halfFloat == 0u ) {

			return 1.0 / f32( sampleCount );

		}

		let pair = ( sampleCount - 1u ) / 2u + 1u;
		var index = pair;
		var halton = 0.0;
		var digitWeight = 0.5;
		while ( index > 0u ) {

			halton += f32( index % 2u ) * digitWeight;
			index /= 2u;
			digitWeight *= 0.5;

		}

		let amplitude = min( f32( 2u * pair - 1u ) / 2048.0, 0.5 ) * ( 2.0 * halton - 1.0 );
		let odd = sampleCount % 2u == 1u;
		let weight = select( 1.0 - amplitude, 1.0 + amplitude, odd );
		let totalWeight = f32( sampleCount ) + select( 0.0, amplitude, odd );
		return weight / totalWeight;

	}

` );
