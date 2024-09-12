# Node-Address-Screen
A command-line utility for bulk screening cryptocurrency addresses using the [Chainalysis Address Screening API](https://docs.chainalysis.com/api/address-screening/).

Accepts a flat-file list of addresses and generates a CSV output file.

Returns attribution and risk rating based on your configured risk rules.  Additional columns for total USD exposure across each of the Chainalysis entity categories.

# Usage
```
node screen-addresses.js [input-file] [output-file]
```

```
node screen-addresses.js example-input.csv example-output.csv
```

For API keys enabled for indirect exposure, add `-i` flag to generate indirect exposure columns

```
node screen-addresses.js example-input.csv example-output.csv -i
```

# Installation

* Ensure you have an installation of node.js > v18
* `git clone` the repository to your local environment
* run `npm install` in the app directory
* create a `.env` file and set `API_KEY=<your Chainalysis API key>`

# Troubleshooting

* Lower the parallelism variable if you are getting timeouts or `429` errors