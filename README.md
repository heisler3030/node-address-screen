# Node-Address-Screen
A command-line utility for bulk screening cryptocurrency addresses using the [Chainalysis Address Screening API](https://docs.chainalysis.com/api/address-screening/).

Accepts a flat-file list of addresses and generates a CSV output file.

Returns attribution and risk rating based on your configured risk rules.  Additional columns for total USD exposure in 31 entity categories.

# Usage
```
node screen-addresses.js [input-file] [output-file]
```

```
node screen-addresses.js example-btc-addresses-250.csv example-output.csv
```


# Installation

* Ensure you have an installation of node.js > v14
* `git clone` the repository to your local environment
* run `npm install` in the app directory
* create a `.env` file and set `API_KEY=<your Chainalysis API key>`

# Troubleshooting

* Lower the parallelism variable if you are getting timeouts (slower connections)