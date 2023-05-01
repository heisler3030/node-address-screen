// address-info.js
//
// Takes an input list of addresses and summarizes risky exposure
//
// Usage:  node screen-addresses.js [input-file] [output-file]
//
// Set environment variable $API_KEY or use .env file
// 
// Input file format:  
//   no header row, 
//   address
// e.g. 0x00Bb9221DaAAF8A703FA19f8CE4822FE8c1B87Eb

const fs = require('fs');
const { request } = require('https');
require('util');
require('path');
const fetch = require('node-fetch');
require('dotenv').config();

// globals
const host = "https://api.chainalysis.com"
const headers = { 'token': process.env.API_KEY }
const rateLimit = 4000 // max number of API requests / minute
const parallelism = 500 // number of simultaneous address screens in each batch

const header_fields = [
  "address", 
  "screenStatus",
  "risk",
  "riskReason",
  "category",
  "name" 
  ]

const categories = [
  "mining pool",
  "fraud shop",
  "high risk jurisdiction",
  "decentralized exchange contract",
  "erc20 token",
  "exchange",
  "lending contract",
  "mixing",
  "protocol privacy",
  "child abuse material",
  "stolen funds",
  "p2p exchange",
  "smart contract",
  "terrorist financing",
  "darknet market",
  "mining",
  "atm",
  "scam",
  "special measures",
  "token smart contract",
  "unnamed service",
  "hosted wallet",
  "ico",
  "high risk exchange",
  "merchant services",
  "online pharmacy",
  "illicit actor-org",
  "ransomware",
  "gambling",
  "other",
  "sanctions",
  "infrastructure as a service"
]

const csv_header = header_fields.concat(categories).join()

async function start(args) {
  if (args.length != 4) {
    console.error("\nUsage:\n  node screen-addresses.js [input-file] [output-file]\n");
    process.exit(1);
  }

  if (!process.env.API_KEY) {
    console.error("\nPlease set $API_KEY environment variable or add to .env file.\n");
    process.exit(1);
  }

  let input = args[2];
  let output = args[3];
  let startTime = Date.now()

  try {
    // Create output file 
    fs.writeFile(output, csv_header + '\n', function (err) {
      if (err) throw err;
      console.log(`Output file ${output} created successfully.`);
    });

    let data = fs.readFileSync(input, 'utf8');
    data = data.split(/\r\n|\r|\n/g)  // Regex to catch annoying CSV linefeed variations
    let batches = splitIntoBatches(data, parallelism);
    let currentBatch = 1
    
    // For rate limiting
    let requestsPerBatch = (2 * parallelism) // two requests per address
    let batchesPerMin = Math.floor(rateLimit/requestsPerBatch)
    let batchTimes = new Array(batchesPerMin).fill(0) // Prefill array with 0 timestamps

    for(let batch of batches) {
      console.log(`Processing batch ${currentBatch} of ${batches.length}...`)
      batchTimes = setBatchTime(batchTimes, Date.now(), batchesPerMin) // For rate limiting
      await processBatch(batch, output)
      await checkRateLimit(batchTimes)  // For rate limiting
      currentBatch++
    }
    let finishTime = Date.now()
    let duration = Math.floor((finishTime - startTime) / 100) / 10
    console.log(`Completed in ${duration} seconds.`)

  } catch (err) {
    console.error(err);
  }
}

function splitIntoBatches(arr, max) {
  const size = Math.min(max, Math.ceil(arr.length / 2));
  return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );
};

async function processBatch(batch, output) {
  let promises = [];

  for(const record of batch) {
    promises.push(check_exposure(record));
  }

  return Promise.all(promises).then((results) => {    

    let final_results = results.map((result) => {
      let row = []
      row.push(result.address)
      row.push(result.screenStatus)
      row.push(result.risk)
      row.push(result.riskReason)
      row.push(result.cluster?.category)
      row.push(result.cluster?.name)
      for (cat of categories) {
        usd_exposure = result.exposures?.find(exposure => (exposure.category == cat))?.value
        row.push(usd_exposure)
      }

      return row.join() // Turn it into a string
    })

    // Write to CSV file
    let write_string = final_results.join('\n')
    fs.appendFile(output, write_string + '\n', function (err) {
      if (err) throw err;
    });
  });
}

async function check_exposure(record) {
  let row = record.split(',');
  let address = row[0]; 
  let body = JSON.stringify({ address })
  let address_info = {}

  try {
    // Register address
    let post = await fetch(host + "/api/risk/v2/entities", {method: "POST", headers: headers, body: body})
    if (!post.ok) throw new Error(response.status + '' + response.statusText)

    // Retrieve info
    let get = await fetch(host + "/api/risk/v2/entities/" + address, {headers: headers})
    if (!get.ok) throw new Error(response.status + '' + response.statusText)
    
    address_info = await get.json()
    address_info.address = address
    address_info.screenStatus = 'complete'
  }
  catch (e) {
    // Populate minimal object with error message
    address_info.address = address
    console.log(`Error screening ${address}:  ${e.message}`)
    address_info.screenStatus = e.message
  }
  finally {
    return address_info
  }

}

//// Utility Functions ////

async function checkRateLimit(batches) {
  // Checks to see if the previous batches are under the rate limit
  let timeSinceBatch = Date.now() - batches[batches.length-1] // time of the oldest batch
  if (timeSinceBatch < 60000) {
    let sleepTime = 61000 - timeSinceBatch
    console.log(`Sleeping for ${sleepTime} ms to manage rate limit`)
    await new Promise(r => setTimeout(r, sleepTime))
  }
}

function setBatchTime (array, item, length) {
  // Adds to a fixed length array of size 'length' which will always have the oldest item at the end
  array.unshift(item) > length ?  array.pop() : null
  return array
}

start(process.argv);