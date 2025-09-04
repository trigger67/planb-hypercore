/** @typedef {import('pear-interface')} */ /* global Pear */
import Corestore from "corestore";
import BlobServer from "hypercore-blob-server";
import Hyperblobs from "hyperblobs";
import Hyperswarm from "hyperswarm";
import Hyperdrive from "hyperdrive";

import path from "bare-path";
import fs from "bare-fs";
import b4a from "b4a";
import process from "bare-process";
import { secretKeyHex } from "./secrets";

let mode;
let core;
let store;
let db;
let blobs;
let swarm;
let server;
let drive;
const filename = "video.mp4";
const { publicKey, secretKey } = createKeyPair();

mainProgram();

async function mainProgram() {
  mode = getModeFromArgs();
  await getCorestore();
  await getHyperDrive();

  addNewVideoToDrive();

  await joinSwarm();

  swarm.on("connection", (conn) => {
    console.log("======= SWARM CONNECTED");
    store.replicate(conn);
    drive.replicate(conn);
    core.download();
  });

  blobs = await drive.getBlobs();
  await startBlobServer();

  console.log("Blobs feed:", blobs.feed);

  setInterval(async () => {
    console.log("=== All files:");
    core.download(); // Or not ?
    const download = drive.download("/");
    await download.done();

    const entry = await drive.entry("/" + filename);
    console.log("entry:", entry);
  }, 10000);
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

async function getCorestore() {
  store = new Corestore(path.join(mode, "storage")); //(path.join(Pear.config.storage, "storage"));
  await store.ready();

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

async function getHyperDrive() {
  // Needs to be changes when db is removed
  const driveKeyHex =
    "1fe22d00087fd4f65b959dc745d83a08b8cbe7a4381524f4bfb58535f90175f7";

  if (mode === "writer") {
    drive = new Hyperdrive(store);
  }
  if (mode === "reader") {
    drive = new Hyperdrive(store, b4a.from(driveKeyHex, "hex"));
  }

  await drive.ready();
  console.log("Drive:", drive.core);
}

async function joinSwarm() {
  const discoveryKey = core.discoveryKey;
  console.log("--Drive core DK:", drive.core.discoveryKey.toString("hex"));
  console.log("--Drive discoveryKey:", drive.discoveryKey.toString("hex"));
  console.log("--Core discoveryKey:", discoveryKey.toString("hex"));
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

async function addNewVideoToDrive() {
  if (mode === "writer") {
    const arrayBuffer = await fs.promises.readFile(filename);
    const buffer = b4a.from(arrayBuffer);

    const entry = await drive.entry("/" + filename);
    console.log("---Drive entry for", filename, ":", entry);
    if (entry == null) {
      console.log("Adding file", filename, "to drive...");
      await drive.put("/" + filename, buffer);
      const entry = await drive.entry("/" + filename);

      fs.appendFileSync(
        "database.txt",
        `${filename},${Buffer.from(JSON.stringify(entry))}\n`
      );

      // PREVIOUS METHOD USING BLOBS DIRECTLY
      // const blobId = await blobs.put(buffer);
      // console.log("Blobs put result:", blobId);

      // if (!blobId.byteLength || blobId.byteLength === 0) {
      //   console.error("==== Error: Blob undefined! Result:", blobId);
      // }

      // fs.appendFileSync(
      //   "database.txt",
      //   `${filename},${Buffer.from(JSON.stringify(blobId))}\n`
      // );
    }
  }
}
