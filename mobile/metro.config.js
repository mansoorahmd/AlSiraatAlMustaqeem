// Metro config — allow bundling the SQLite database file as an asset.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Treat .db as a static asset so it can be shipped inside the app and copied
// out to the writable document directory on first launch.
config.resolver.assetExts.push("db");

module.exports = config;
