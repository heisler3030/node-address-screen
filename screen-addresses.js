// address-info.js
//
// Takes an input list of addresses and summarizes risky exposure
//
// Usage:  node screen-addresses.js [input-file] [output-file] -i
//
// -i:  Include indirect exposure in the output (for indirect-authorized API key only)
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
const rateLimit = 3800 // max number of API requests / minute
const parallelism = 45 // number of simultaneous address screens in each batch
const DIRECT = 'direct' // API label for direct exposure
const INDIRECT = 'indirect' // API label for indirect exposure
let include_indirect = false // include indirect exposure

const header_fields = [
  "address", 
  "screenStatus",
  "risk",
  "riskReason",
  "category",
  "name" 
  ]

async function start(args) {
  if (!(args.length == 4 | (args.length == 5 && args[4] == '-i'))) {
    console.error("\nUsage:\n  node screen-addresses.js [input-file] [output-file]\n\n  -i:  Include indirect exposure in the output (for indirect-authorized API key only)\n");
    process.exit(1);
  }

  if (!process.env.API_KEY) {
    console.error("\nPlease set $API_KEY environment variable or add to .env file.\n");
    process.exit(1);
  }

  let input = args[2];
  let output = args[3];
  if (args[4] == '-i') include_indirect = true;
  let startTime = Date.now()

  let categories = await fetchCategories()
  let csv_header = header_fields.concat(categories).join()
  if (include_indirect) {
    csv_header = header_fields.concat((categories).map(c => `${c}_direct,${c}_indirect`)).join();
  }

  try {
    // Create output file 
    fs.writeFile(output, csv_header + '\n', function (err) {
      if (err) throw err;
      console.log(`Output file ${output} created successfully.`);
    });

    let data = fs.readFileSync(input, 'utf8');
    data = data.split(/\r\n|\r|\n/g)  // Regex to catch annoying CSV linefeed variations
    data = data.filter(Boolean) // Remove empty lines
    let batches = splitIntoBatches(data, parallelism);
    let currentBatch = 1
    
    // For rate limiting - see checkRateLimit function
    let requestsPerBatch = (2 * parallelism) // two requests per address
    let batchesPerMin = Math.floor(rateLimit/requestsPerBatch)
    let batchTimes = new Array(batchesPerMin).fill(0) // Initialize rate limit array

    for(let batch of batches) {
      console.log(`Processing batch ${currentBatch} of ${batches.length}...`)
      batchTimes = setBatchTime(batchTimes, Date.now(), batchesPerMin) // Record start time for rate limiter
      await processBatch(batch, output)
      await checkRateLimit(batchTimes)
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
        if (include_indirect) {
          let usd_direct = result.exposures?.find(exposure => (exposure.category == cat && exposure.exposureType == DIRECT))?.value
          let usd_indirect = result.exposures?.find(exposure => (exposure.category == cat && exposure.exposureType == INDIRECT))?.value
          row.push(usd_direct)
          row.push(usd_indirect)
        } else {
          // Constructed to work with both direct and indirect API keys
          let usd_exposure = result.exposures?.find(exposure => (exposure.category == cat && !(exposure.exposureType == INDIRECT)))?.value 
          row.push(usd_exposure)
        }
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
    if (!post.ok) throw new Error(post.status + ' ' + post.statusText)

    // Retrieve info
    let get = await fetch(host + "/api/risk/v2/entities/" + address, {headers: headers})
    if (!get.ok) throw new Error(get.status + ' ' + get.statusText)
    
    address_info = await get.json()
    address_info.address = address
    address_info.screenStatus = 'complete'
  }
  catch (e) {
    // Populate minimal object with error message
    address_info.address = address
    console.error(`Error screening ${address}:  ${e.message}`)
    address_info.screenStatus = e.message
  }
  finally {
    return address_info
  }

}

//// Utility Functions ////

async function fetchCategories() {
  console.log("Retrieving Chainalysis Categories...")
  try {
    let get = await fetch("https://reactor.chainalysis.com/api/v2/categories", {headers: headers})
    if (!get.ok) throw new Error(get.status + ' ' + get.statusText)
    
    categories = await get.json()
    return categories.sort()
  }
  catch (e) {
    throw Error(`Error getting categories:  ${e.message}`)
  }
}


async function checkRateLimit(batches) {
  // Checks to see if the previous batches are under the rate limit
  // Logic:  
  //   - Every time a batch is launched the start time is pushed into an array (setBatchTime)
  //   - The array is sized equal to the max batches per minute
  //   - The last entry in the array is the oldest batch
  //   - If the oldest batch is newer than 1 min old then the sleep time is calculated
  //     to prevent overage
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