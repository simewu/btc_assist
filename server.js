const fetch = require('node-fetch');
const express = require('express');
const redis = require('redis');
const app = express();

const PORT = process.env.PORT || 3000;
const REDIS_PORT = process.env.REDIS_PORT || 6379;
let redisClient
if(process.env.REDISCLOUD_URL){
	let redisURL = url.parse(process.env.REDISCLOUD_URL);
	redisClient = redis.createClient(redisURL)
} else {
	redisClient = redis.createClient(REDIS_PORT);
}

// Mainenance
var queue = [], queueInterval = null, knownBlocks = [], maxKnownBlock = null, latestHeight = null;

Array.prototype.remove = function(value) {
	for (var i = this.length; i--; ) {
		if (this[i] === value) {
			this.splice(i, 1);
		}
	}
}

// Fetch any key from Redis, results the corresponding value, or null
function redisGet(key) {
	return new Promise(resolve => {
		redisClient.get(key.toString(), async function(error, reply) {
			if(error || reply == null) {
				resolve(null);
			} else {
				resolve(reply.toString());
			}
		});
	});
}

// Set a key, value within the Redis database
function redisSet(key, value) {
	key = key.toString();
	value = value.toString();
	redisClient.set(key, value);
	return value;
}

// Request a block
async function getBlock(height) {
	height = parseInt(height);
	if(isNaN(height)) return null;

	block = await new Promise(resolve => {
		redisClient.get(height.toString(), async function(error, reply) {
			if(error || reply == null) {
				let rawBlock = await fetchBlockFromBlockchain(height);
				if(rawBlock === null) {
					resolve(null);
				} else {
					resolve(processBlock(height, rawBlock));
				}
			} else {
				try {
					resolve(JSON.parse(reply.toString()));
				} catch(e) {
					console.log('Failed to convert block ' + height + ' to JSON.');
					resolve(null);
				}
			}

		});
	});
	return block;
}

async function fetchLatestHeightFromBlockchain() {
	return await fetch('https://blockchain.info/latestblock', {method:'GET'})
		.then(res => res.json())
		.then((json) => {
			if('height' in json) {
				return json['height'];
			}
			return null;
		})
		.catch(error => {
			console.log('Error fetching latest block height');
			return null;
		});
}

async function fetchBlockFromBlockchain(height) {
	return await fetch(`https://blockchain.info/block-height/${height}?format=json`, {method:'GET'})
		.then(res => res.json())
		.then((json) => {
			return json;
		})
		.catch(error => {
			console.log(`Error fetching block height ${height}`);
			return null;
		});
}

// Given a raw block straight from blockchain.com, convert it into one we can use
function processBlock(height, rawBlock) {
	let epoch = Math.round(Date.now() / 1000);
	let _block = null
	if('blocks' in rawBlock) {
		switch(rawBlock['blocks'].length) {
			case 0:
				console.log(`No block was given: ${JSON.stringify(rawBlock)}`)
				return null;
				break;
			case 1:
				_block = rawBlock['blocks'][0];
				break;
			default:
				console.log(`Fork detected on height ${height}`);
				for(b of rawBlock['blocks']) {
					if(('main_chain' in b) && b['main_chain'] == true) {
						_block = rawBlock['blocks'][0];
						break
					}
				}
		}
	} else {
		console.log(`Block not in "blocks" object: ${rawBlock}`);
		_block = rawBlock;
	}
	if(_block === null || !('main_chain' in _block) || _block['main_chain'] != true) return null



	let _transactions = [];
	let transactions = [];
	// Process each transaction into only the data that is needed
	let coinbase_value = 0;
	let totalTxValue = 0;
	let totalTxValueUnspent = 0;
	let totalTxFee = 0;
	if('tx' in _block) {
		for(let tx of _block['tx']) {
			let isCoinbase = false;
			txValueWithFee = 0;
			txValue = 0;
			txValueUnspent = 0;
			// Compute the input value (includes fee)
			if('inputs' in tx) {
				for(let input of tx['inputs']) {
					if('prev_out' in input) {
						txValueWithFee += input['prev_out']['value'] || 0;
					} else {
						isCoinbase = true;
					}
				}
			}
			// Compute the output value (excludes fee)
			if('out' in tx) {
				for(let output of tx['out']) {
					if(isCoinbase) {
						coinbase_value += output['value'] || 0;
					} else {
						txValue += output['value'] || 0;
						if('spent' in output && output['spent'] == false) {
							txValueUnspent += output['value'] || 0;
						}
					}
				}
			}
			// Satoshi to BTC
			tx_fee = (txValueWithFee - txValue) / 100000000;
			txValue /= 100000000;
			txValueUnspent /= 100000000;

			totalTxValue += txValue;
			totalTxValueUnspent += txValueUnspent;
			totalTxFee += tx_fee;

			_transactions.push({
				value: txValue,
				valueUnspent: txValueUnspent,
				fee: tx_fee
			})
		}
	}
	coinbase_value /= 100000000;
	numTxValuesAt = {
		'0.125': 0,
		'0.25': 0,
		'0.5': 0,
		'1': 0,
		'2': 0,
		'4': 0,
		'8': 0,
		'16': 0,
		'32': 0,
		'64': 0,
		'128': 0,
		'256': 0,
		'512': 0,
		'1024': 0,
		'2048': 0,
		'4096': 0,
	}
	numTxValuesUnspentAt = {
		'0.125': 0,
		'0.25': 0,
		'0.5': 0,
		'1': 0,
		'2': 0,
		'4': 0,
		'8': 0,
		'16': 0,
		'32': 0,
		'64': 0,
		'128': 0,
		'256': 0,
		'512': 0,
		'1024': 0,
		'2048': 0,
		'4096': 0,
	}

	for(let tx of _transactions) {
		if(tx.value >= 0.125) numTxValuesAt['0.125']++;
		if(tx.value >= 0.25) numTxValuesAt['0.25']++;
		if(tx.value >= 0.5) numTxValuesAt['0.5']++;
		if(tx.value >= 1) numTxValuesAt['1']++;
		if(tx.value >= 2) numTxValuesAt['2']++;
		if(tx.value >= 4) numTxValuesAt['4']++;
		if(tx.value >= 8) numTxValuesAt['8']++;
		if(tx.value >= 16) numTxValuesAt['16']++;
		if(tx.value >= 32) numTxValuesAt['32']++;
		if(tx.value >= 64) numTxValuesAt['64']++;
		if(tx.value >= 128) numTxValuesAt['128']++;
		if(tx.value >= 256) numTxValuesAt['256']++;
		if(tx.value >= 512) numTxValuesAt['512']++;
		if(tx.value >= 1024) numTxValuesAt['1024']++;
		if(tx.value >= 2048) numTxValuesAt['2048']++;
		if(tx.value >= 4096) numTxValuesAt['4096']++;

		if(tx.valueUnspent >= 0.125) numTxValuesUnspentAt['0.125']++;
		if(tx.valueUnspent >= 0.25) numTxValuesUnspentAt['0.25']++;
		if(tx.valueUnspent >= 0.5) numTxValuesUnspentAt['0.5']++;
		if(tx.valueUnspent >= 1) numTxValuesUnspentAt['1']++;
		if(tx.valueUnspent >= 2) numTxValuesUnspentAt['2']++;
		if(tx.valueUnspent >= 4) numTxValuesUnspentAt['4']++;
		if(tx.valueUnspent >= 8) numTxValuesUnspentAt['8']++;
		if(tx.valueUnspent >= 16) numTxValuesUnspentAt['16']++;
		if(tx.valueUnspent >= 32) numTxValuesUnspentAt['32']++;
		if(tx.valueUnspent >= 64) numTxValuesUnspentAt['64']++;
		if(tx.valueUnspent >= 128) numTxValuesUnspentAt['128']++;
		if(tx.valueUnspent >= 256) numTxValuesUnspentAt['256']++;
		if(tx.valueUnspent >= 512) numTxValuesUnspentAt['512']++;
		if(tx.valueUnspent >= 1024) numTxValuesUnspentAt['1024']++;
		if(tx.valueUnspent >= 2048) numTxValuesUnspentAt['2048']++;
		if(tx.valueUnspent >= 4096) numTxValuesUnspentAt['4096']++;

		transactions.push(tx.value);
	}

	let block = {};
	block['height'] = _block['height'] || height;
	block['size'] = _block['size'] || 0;
	block['num_tx'] = _block['n_tx'] || 0;
	block['timestamp'] = _block['time'] || height;
	block['timestamp_fetched'] = epoch;
	block['coinbase_value'] = coinbase_value;
	block['total_tx_value'] = totalTxValue;
	block['total_tx_value_unspent'] = totalTxValueUnspent;
	block['total_tx_fee'] = totalTxFee;
	block['hash'] = _block['hash'] || 0;
	block['prev_hash'] = _block['prev_block'] || '';
	block['nonce'] = _block['nonce'] || '';
	block['bits'] = _block['bits'] || 0;

	block['num_tx_values_at'] = numTxValuesAt;
	block['num_tx_values_unspent_at'] = numTxValuesUnspentAt;
	block['transactions'] = transactions;

	/*// Build the transaction histogram
	let quantile_values = {
		'0': transaction_quantile('value', transactions, 0), // Max value
		'25': transaction_quantile('value', transactions, 25),
		'50': transaction_quantile('value', transactions, 50),
		'75': transaction_quantile('value', transactions, 75),
		'99': transaction_quantile('value', transactions, 99),
		'100': transaction_quantile('value', transactions, 100) // Min value
	};
	let quantile_values_unspent = {
		'0': transaction_quantile('valueUnspent', transactions, 0), // Max value
		'25': transaction_quantile('valueUnspent', transactions, 25),
		'50': transaction_quantile('valueUnspent', transactions, 50),
		'75': transaction_quantile('valueUnspent', transactions, 75),
		'99': transaction_quantile('valueUnspent', transactions, 99),
		'100': transaction_quantile('valueUnspent', transactions, 100) // Min value
	};
	let quantile_fees = {
		'0': transaction_quantile('fee', transactions, 0), // Max value
		'25': transaction_quantile('fee', transactions, 25),
		'50': transaction_quantile('fee', transactions, 50),
		'75': transaction_quantile('fee', transactions, 75),
		'99': transaction_quantile('fee', transactions, 99),
		'100': transaction_quantile('fee', transactions, 100) // Min value
	};

	tx_histogram_values = new Array(10).fill(0);
	tx_histogram_values_unspent = new Array(10).fill(0);
	tx_histogram_fees = new Array(10).fill(0);

	top_99_percentile_tx_values = [];
	top_99_percentile_tx_values_unspent = [];
	top_99_percentile_tx_fees = [];

	let index, index_unspent, index_fees;
	for(let tx of transactions) {
		if(quantile_values['100'] == 0) index = 0
		else index = Math.floor((tx.value / quantile_values['100']) * 9);
		tx_histogram_values[index]++;

		if(quantile_values_unspent['100'] == 0) index_unspent = 0
		else index_unspent = Math.floor((tx.valueUnspent / quantile_values_unspent['100']) * 9);
		tx_histogram_values_unspent[index_unspent]++;

		if(quantile_fees['100'] == 0) index_fees = 0
		else index_fees = Math.floor((tx.fee / quantile_fees['100']) * 9);
		tx_histogram_fees[index_fees]++;

		if(tx.value >= quantile_values['99']) top_99_percentile_tx_values.push(tx);
		if(tx.valueUnspent >= quantile_values_unspent['99']) top_99_percentile_tx_values_unspent.push(tx);
		if(tx.fee >= quantile_fees['99']) top_99_percentile_tx_fees.push(tx);
	}

	block['quantile_values'] = quantile_values;
	block['quantile_values_unspent'] = quantile_values_unspent;
	block['quantile_fees'] = quantile_fees;

	block['histogram_values'] = tx_histogram_values;
	block['histogram_values_unspent'] = tx_histogram_values_unspent;
	block['histogram_fees'] = tx_histogram_fees;

	block['top_99_percentile_tx_values'] = top_99_percentile_tx_values;
	block['top_99_percentile_tx_values_unspent'] = top_99_percentile_tx_values_unspent;
	block['top_99_percentile_tx_fees'] = top_99_percentile_tx_fees;*/

	// TODO: Add a way to override caching, if a block is outdated or something
	
	redisSet(height.toString(), JSON.stringify(block));
	queue.remove(height);
	knownBlocks.push(height);
	console.log(`Block height ${height} has been cached.`)

	return block;
}

// Compute the quantile, which is the percentage of a threshold
/*function transaction_quantile(key, transactions, percentile) {
	transactions.sort((a, b) => {
		return a[key] - b[key];
	});
	let index = percentile / 100 * (transactions.length - 1);
	if(Math.floor(index) == index) {
		quantile = transactions[index][key];
	} else {
		i = Math.floor(index);
		fraction = index - i;
		quantile = transactions[i][key] + (transactions[i + 1][key] - transactions[i][key]) * fraction;
	}
	return quantile;
}*/

/*
 * Maintenance functions
 */

// Keep a list of known blocks in memory
redisClient.keys('*', (err, keys) => {
	if(err) throw err;
	for(key of keys) {
		var height = parseInt(key);
		if(!isNaN(height)) {
			knownBlocks.push(height);
		}
	}
	knownBlocks.sort();
	console.log('Loaded in known blocks.');
});

// Fetch the maxKnownBlock variable from the database
redisGet('maxKnownBlock').then(result => {
	maxKnownBlock = parseInt(result) || 0;
	if(maxKnownBlock == null) {
		redisSet('maxKnownBlock', 0);
		maxKnownBlock = 0;
	}
	console.log(`Loaded in max known height: ${maxKnownBlock}.`);

	setTimeout(updateBlockchain, 10 * 1000); // Wait 10 seconds before looking to the blockchain data
});

// Ran every 3 minutes
async function regularBlockFetcher() {
	if(queue.length == 0) { // Stop checking if the queue is empty
		clearInverval(queueInterval);
		queueInterval = null;
		return;
	}
	var block = queue[0];
	// Remove already known entries
	while(knownBlocks.includes(block)) {
		if(queue.length == 0) { // If nothing is left in the queue, stop looking
			clearInverval(queueInterval);
			queueInterval = null;
			return;
		}
		queue.shift();
		block = queue[0];
	}
	console.log(`Regular mainenance: Fetched block ${block} from online.`);
	await getBlock(block);
	if(block > maxKnownBlock) {
		redisSet('maxKnownBlock', block);
		maxKnownBlock = block;
	}
}

// Gets the latest block height, then verifies that the queue is being handled
async function updateBlockchain() {
	let epoch = Math.round(Date.now() / 1000);
	latestHeight = await fetchLatestHeightFromBlockchain();
	if(maxKnownBlock ===  null || latestHeight === null) return;

	var numBlocksAddedToQueue = 0;
	for(let i = maxKnownBlock + 1; i < latestHeight; i++) {
		if(!knownBlocks.includes(i)) {
			queue.push(i);
			numBlocksAddedToQueue++;
		}
	}
	console.log(`Regular mainenance: Added ${numBlocksAddedToQueue} blocks to the queue.`);

	if(maxKnownBlock != latestHeight) {
		if(queueInterval === null) {
			queueInterval = setInterval(regularBlockFetcher, 3 * 60 * 1000);
		}
	}
}

var latestBlockFetcher = setInterval(updateBlockchain, 60 * 60 * 1000); // Every hour


/*
 * App functions
 */


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
			response.json({'Error': 'The block may not have been mined yet.'});
			return;
		}
		
		response.json(block);
	});
});

/* Begin listening */

let server = app.listen(PORT, () => {
	let host = server.address().address;
	let port = server.address().port;
	console.log(`Listening at localhost port ${port}`);
	console.log();
});