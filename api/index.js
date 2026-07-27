const { handleRequest } = require("../server");

module.exports = handleRequest;
// Opt into response streaming on Vercel's Node runtime — without this the
// platform buffers the coach SSE stream and delivers it as one flush at the
// end, silently degrading "streaming" to a long wait.
module.exports.supportsResponseStreaming = true;
