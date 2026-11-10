// Paired, bounded Halton weights keep the cumulative weight analytic: every pair sums to two.
// sampleCount is the one-based count of the sample being accumulated.
export function getAccumulationWeight( sampleCount ) {

	const pair = Math.floor( ( sampleCount - 1 ) / 2 ) + 1;
	let index = pair;
	let halton = 0;
	let digitWeight = 0.5;
	while ( index > 0 ) {

		halton += ( index % 2 ) * digitWeight;
		index = Math.floor( index / 2 );
		digitWeight *= 0.5;

	}

	const amplitude = Math.min( ( 2 * pair - 1 ) / 2048, 0.5 ) * ( 2 * halton - 1 );
	const odd = sampleCount % 2 === 1;
	const weight = odd ? 1 + amplitude : 1 - amplitude;
	const totalWeight = odd ? sampleCount + amplitude : sampleCount;
	return weight / totalWeight;

}
