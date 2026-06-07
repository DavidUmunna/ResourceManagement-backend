require("dotenv").config();
const net = require("net");
const { spawn } = require("child_process");

const REDIS_HOST = "127.0.0.1";
const REDIS_PORT = 6379;
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 2000;
const NTFY_TOPIC = process.env.NTFY_TOPIC;

async function sendAlert(message) {
  try {
    await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: "POST",
      body: message,
      headers: {
        "Title": "Halden Backend Alert",
        "Priority": "urgent",
        "Tags": "warning,server",
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
    console.log("Alert sent to phone");
  } catch (err) {
    console.error("Failed to send alert:", err.message);
  }
}

function checkRedis(retriesLeft) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    socket.setTimeout(1500);

    socket.connect(REDIS_PORT, REDIS_HOST, () => {
      console.log("Redis is up");
      socket.destroy();
      resolve();
    });

    socket.on("error", (err) => {
      socket.destroy();
      if (retriesLeft <= 1) {
        reject(new Error(`Redis not available after retries: ${err.message}`));
      } else {
        console.log(`Redis not ready, retrying... (${retriesLeft - 1} left)`);
        setTimeout(() => checkRedis(retriesLeft - 1).then(resolve).catch(reject), RETRY_DELAY_MS);
      }
    });

    socket.on("timeout", () => {
      socket.destroy();
      if (retriesLeft <= 1) {
        reject(new Error("Redis connection timed out after retries"));
      } else {
        console.log(`Redis timed out, retrying... (${retriesLeft - 1} left)`);
        setTimeout(() => checkRedis(retriesLeft - 1).then(resolve).catch(reject), RETRY_DELAY_MS);
      }
    });
  });
}

checkRedis(MAX_RETRIES)
  .then(() => {
    // Redis is up, now start the actual server
    console.log("Starting server.js...");
    const server = spawn("node", ["server.js"], { stdio: "inherit" });

    server.on("exit", (code) => {
      console.log(`server.js exited with code ${code}`);
      process.exit(code);
    });
  })
  .catch(async (err) => {
    console.error(err.message);
    await sendAlert(
      `[Halden Backend] Redis failed to start on your VPS.\n` +
      `Error: ${err.message}\n` +
      `Time: ${new Date().toISOString()}\n` +
      `Action needed: SSH in and run: sudo systemctl restart redis-server`
    );
    process.exit(1);
  });