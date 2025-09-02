/** @typedef {import('pear-interface')} */ /* global Pear */
import Corestore from "corestore";
import BlobServer from "hypercore-blob-server";
import Hyperblobs from "hyperblobs";
import Hyperswarm from "hyperswarm";
import Hyperbee from "hyperbee";

import path from "path";
import fs from "fs";
import b4a from "b4a";
import process from "process";
import { secretKeyHex } from "./secrets";

let mode;
let core;
let store;
let db;
let blobs;
let swarm;
let server;

mainProgram();

async function mainProgram() {
  mode = getModeFromArgs();
  await getHyperCore();
  await getHyperBeeDb();

  blobs = new Hyperblobs(core);
  addNewVideoToBlob();

  await joinSwarm();

  swarm.on("connection", (conn) => {
    console.log("======= SWARM CONNECTED");
    store.replicate(conn);
    db.replicate(conn);
    core.download();
  });

  await startBlobServer();

  console.log("Feed:", blobs.feed);

  setInterval(async () => {
    console.log("=== All files:");
    core.download(); // Or not ?
    for await (const { key, value } of db.createReadStream()) {
      console.log("File:", key, "→ BlobId:", value);
    }
  }, 30000);
}

////////////////////////////////////////
/*** Functions ***/
////////////////////////////////////////
function getModeFromArgs() {
  const args = process.argv.slice(2);
  console.log("Args:", args);

  let mode = "reader";
  for (const arg of args) {
    if (arg.startsWith("--mode=")) {
      mode = arg.split("=")[1];
      console.log("Mode set to:", mode);
    }
  }
  return mode;
}

async function getHyperCore() {
  store = new Corestore(path.join(mode, "storage")); //(path.join(Pear.config.storage, "storage"));
  await store.ready();
  const { publicKey, secretKey } = createKeyPair();

  if (mode === "writer") {
    core = store.get({
      keyPair: { publicKey, secretKey },
    });
  }

  if (mode === "reader") {
    core = store.get({
      keyPair: { publicKey },
    });
  }

  // const core = store.get({ name: "video-stream" });
  await core.ready();
  console.log("Core key", core.key.toString("hex"));
}

async function getHyperBeeDb() {
  db = new Hyperbee(store.get({ name: "index" }), {
    keyEncoding: "utf-8",
    valueEncoding: "json",
  });
}

async function joinSwarm() {
  const discoveryKey = core.discoveryKey;
  if (discoveryKey && discoveryKey.byteLength === 32) {
    swarm = new Hyperswarm();
    console.log("Joining swarm...");
    await swarm.join(discoveryKey);
    console.log("Joined swarm with corestore's discovery key");
    swarm.flush();
  } else {
    throw new Error("Corestore discovery key is not a valid 32-byte buffer.");
  }
}

async function startBlobServer() {
  const server = new BlobServer(store); //new HypercoreBlobServer(blobs);
  server.listen();
}

function createKeyPair() {
  const publicKeyHex =
    "e60718aa07987546d2ab9b95bfe9eea26ddf5792bec1de1ac0f08f9f4d4ee7ef";

  return {
    publicKey: b4a.from(publicKeyHex, "hex"),
    secretKey: b4a.from(secretKeyHex, "hex"),
  };
}

async function addNewVideoToBlob() {
  if (mode === "writer") {
    const filename = "video.mp4";
    const arrayBuffer = await fs.promises.readFile(filename);
    const buffer = b4a.from(arrayBuffer);

    const blobId = await blobs.put(buffer);
    await db.put(filename, { blobId: JSON.stringify(blobId) });

    if (!blobId.byteLength || blobId.byteLength === 0) {
      console.error("==== Error: Blob undefined! Result:", blobId);
    }

    fs.appendFileSync(
      "database.txt",
      `${filename},${Buffer.from(JSON.stringify(blobId))}\n`
    );
  }
}
