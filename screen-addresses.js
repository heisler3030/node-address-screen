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
require('util');
require('path');
const fetch = require('node-fetch');
require('dotenv').config();

// globals
const host = "https://api.chainalysis.com"
const headers = { 'token': process.env.API_KEY }
const sleepTime = 1

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
  "unnamed service",
  "token smart contract",
  "hosted wallet",
  "merchant services",
  "high risk exchange",
  "ico",
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

  let input = args[2];
  let output = args[3];

  try {
    // Create output file 
    fs.writeFile(output, csv_header + '\n', function (err) {
      if (err) throw err;
      console.log(`Output file ${output} created successfully.`);
    });

    let data = fs.readFileSync(input, 'utf8');
    data = data.split(/\r\n|\r|\n/g)  // Regex to catch annoying CSV linefeed variations
    let batches = splitIntoBatches(data, 100);
    let currentBatch = 1

    for(let batch of batches) {
      console.log(`Processing batch ${currentBatch} of ${batches.length}...`)
      await processBatch(batch, output);
      await new Promise(r => setTimeout(r, sleepTime)); // keep IAPI rate limiter at bay
      currentBatch++
    }
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
    address_info.screenStatus = e.message
  }
  finally {
    return address_info
  }

}

start(process.argv);