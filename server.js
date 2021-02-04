const fetch = require('node-fetch');
const express = require('express');
const redis = require('redis');

const PORT = process.env.PORT || 3000;
const REDIS_PORT = process.env.REDIS_PORT || 6379;

const redisClient = redis.createClient(REDIS_PORT);
const app = express();

async function fetchFromBlockchain(height) {
	return await fetch(`https://blockchain.info/block-height/${height}?format=json`, {method:'GET'})
		.then(res => res.json())
		.then((json) => {
			console.log('Returned!')
			return json;
		}
	);
}

async function getBlock(height) {
	console.log('LET    US     BEGIN!!!');
	//return await fetchFromBlockchain(height);
	block = await new Promise(resolve => {
		redisClient.get(height.toString(), async function(error, reply) {
			//console.log(reply)
			if(error || reply == null) {
				console.log('!!! Fetching from online, block at height ' + height);
				//return 100;//await fetchFromBlockchain(height);
				//return processBlock(height, await fetchFromBlockchain(height));
				let rawBlock = await fetchFromBlockchain(height);
				resolve(processBlock(height, rawBlock));

			} else {
				console.log('!!! Found cached block at height ' + height);
				resolve(JSON.parse(reply.toString()));
			}

		});
	});
	return block;
}

// Given a raw block straight from blockchain.com, convert it into one we can use
function processBlock(height, rawBlock) {
	let shouldCache = false;
	if('blocks' in rawBlock) {
		switch(rawBlock['blocks'].length) {
			case 0:
				// No block was given?
				console.log(`No block was given: ${JSON.stringify(rawBlock)}`)
				return [shouldCache, null];
				break
			case 1:
				shouldCache = true;
				_block = rawBlock['blocks'][0];
			default:
				// If fork, don't cache, use the first
				console.log(`Fork, not caching: ${JSON.stringify(rawBlock)}`)
				_block = rawBlock['blocks'][0];
		}
	} else {
		console.log(`Block not in "blocks" object: ${rawBlock}`);
		_block = rawBlock;
	}

	let block = {};
	block['height'] = _block['height'] || height;
	block['size'] = _block['size'] || 0;
	block['num_tx'] = _block['n_tx'] || 0;
	block['timestamp'] = _block['timestamp'] || height;
	block['fee'] = _block['fee'] || 0;
	block['hash'] = _block['hash'] || 0;
	block['prev_hash'] = _block['prev_hash'] || 0;
	block['main_chain'] = _block['main_chain'] || true;
	block['block_index'] = _block['block_index'] || 0;
	block['merkle_root'] = _block['mrkl_root'] || '';
	block['nonce'] = _block['nonce'] || '';
	block['bits'] = _block['bits'] || 0;

	max_tx_value = 0;
	transactions = [];
	// Process each transaction into only the data that is needed
	if('tx' in _block) {
		for(let tx of _block['tx']) {
			tx_value_with_fee = 0;
			tx_value = 0;
			tx_value_unspent = 0;
			// Compute the input value (includes fee)
			if('inputs' in tx) {
				for(let input of tx['inputs']) {
					if('prev_out' in input) {
						tx_value_with_fee += input['prev_out']['value'] || 0;
					}
				}
			}
			// Compute the output value (excludes fee)
			if('out' in tx) {
				for(let output of tx['out']) {
					tx_value += output['value'] || 0;
					if('spent' in output && output['spent'] == false) {
						tx_value_unspent += output['value'] || 0;
					}
				}
			}
			// Satoshi to BTC
			fee = (tx_value_with_fee - tx_value) / 100000000;
			tx_value /= 100000000;
			tx_value_unspent /= 100000000;
			hash = tx['hash'] || '';

			transactions.push({
				value: tx_value,
				value_unspent: tx_value_unspent,
				fee: fee,
				hash: hash
			})

			if(tx_value > max_tx_value) max_tx_value = tx_value;
		}
	}
	// Build the transaction histogram
	let quantile_0 = transaction_quantile(transactions, 0);
	let quantile_25 = transaction_quantile(transactions, 25);
	let quantile_33 = transaction_quantile(transactions, 33);
	let quantile_50 = transaction_quantile(transactions, 50);
	let quantile_66 = transaction_quantile(transactions, 66);
	let quantile_75 = transaction_quantile(transactions, 75);
	let quantile_100 = transaction_quantile(transactions, 100);

	// Only keep quartile 3 and greater
	tx_histogram = new Array(100).fill([]);
	for(let tx of transactions) {
		if(tx.value < quantile_75) continue;
		let index = Math.floor(((tx.value - quantile_75) / (max_tx_value - quantile_75)) * 99);
		tx_histogram[index].push(tx);
	}

	block['tx_quantile_0'] = quantile_0; // Min value
	block['tx_quantile_25'] = quantile_25;
	block['tx_quantile_33'] = quantile_33;
	block['tx_quantile_50'] = quantile_50;
	block['tx_quantile_66'] = quantile_66;
	block['tx_quantile_75'] = quantile_75;
	block['tx_quantile_100'] = quantile_100; // Max value
	block['histogram'] = tx_histogram;

	// TODO: Add a way to override caching, if a block is outdated or something
	console.log('IT HAS BEEN CACHED')
	redisClient.set(height.toString(), JSON.stringify(block));

	return block;
}

// Compute the quantile, which is the percentage of a threshold
function transaction_quantile(transactions, percentile) {
    transactions.sort((a, b) => {
    	return a.value - b.value;
    });
    let index = percentile / 100 * (transactions.length - 1);
    if(Math.floor(index) == index) {
    	quantile = transactions[index].value;
    } else {
        i = Math.floor(index);
        fraction = index - i;
        quantile = transactions[i].value + (transactions[i + 1].value - transactions[i].value) * fraction;
    }
    return quantile;
}

app.set('port', PORT);

/* Routes */

app.get('/',(request, response) => {
    response.sendFile(`${__dirname}/index.html`);
});

app.get('/lib/:file', (request, response) => {
	response.sendFile(`${__dirname}/lib/${request.params.file}`);
});

app.get('/blocks/:height',(request, response) => {
	let height = parseInt(request.params.height);
	if(height < 0) {
		response.json(null);
		return;
	}
	getBlock(height).then((block) => {
		if(typeof block != 'object') {
			response.json({'Error?': 'unfortunately'});
			return;
		}
		
    	response.json(block);
	});
});

/* Begin listening */

var server = app.listen(PORT, () => {
	var host = server.address().address;
	var port = server.address().port;
	console.log('Listening at localhost port ' + port);
	console.log();
});