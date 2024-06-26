const socket = require("socket.io-client");
const { Ableton } = require("ableton-js");
require("dotenv").config();

// imports
const templateSocketEmit = require("./templateSocketEmit");

// global vars
const ableton = new Ableton({ logger: console });
const song = ableton.song;
const tempTrack = { percentage: 0, timer: 0 };

let isPlaying;

const defaultTempo = 60;
let diffTempo;

// socket init
const server = socket(process.env.API_URL);
server.on("connect", () => {
  console.log("[ServerIO] Connected.");
});

// ableton init
const initAbleton = async () => {
  await ableton.start();

  song.addListener("is_playing", (status) => (isPlaying = status));

  initTimers();
};

// animation data
const initTracksOutputData = async () => {
  const drumsTracks = await song
    .get("tracks")
    .then((tracks) =>
      tracks.filter((track) => track.raw.name.includes("Drums"))
    );

  drumsTracks.forEach((track) =>
    track.addListener("output_meter_left", (outputData) => {
      isPlaying &&
        server.emit(
          "abletonToDisplay",
          templateSocketEmit("audioData", { outputData })
        );
    })
  );
};

// timer data
const initTimers = async () => {
  let tracksEndTime;

  song.addListener("tracks", async () => {
    tracksEndTime = await initTimersBody();
  });

  song.addListener("current_song_time", async (time) => {
    tracksEndTime = await initTimersBody();
    initSendTimerData(time, tracksEndTime);
  });
};

const initTimersBody = async () => {
  let tracks = await song.get("tracks");
  let currentTempo = await song.get("tempo");
  diffTempo = currentTempo / defaultTempo;

  return await calcTracksEndTime(tracks);
};

// find and calc start-end times
const calcTracksEndTime = async (tracks) => {
  let tracksEndTime = [];

  const trackNames = await Promise.all(
    tracks.map((track) => track.get("name"))
  );

  for (let i = 0; i < tracks.length; i++) {
    const trackName = trackNames[i];

    if (trackName.toLowerCase().includes("timer")) {
      const clipSlots = await tracks[i].get("clip_slots");

      const isClipGrouped = await clipSlots[0].get("is_group_slot");

      if (!isClipGrouped) {
        const arrangementClips = await tracks[i].get("arrangement_clips");
        const { start_time, end_time } = arrangementClips[0]?.raw;

        tracksEndTime.push({
          startTime: start_time > 0 ? Math.floor(start_time) / diffTempo : 0,
          endTime: Math.floor(end_time) / diffTempo,
        });
      }
    }
  }

  tracksEndTime = Array.from(
    new Set(tracksEndTime.map((obj) => JSON.stringify(obj)))
  ).map((str) => JSON.parse(str));

  return tracksEndTime;
};

// sender formatted percentage and timer
const initSendTimerData = async (time, tracksEndTime) => {
  let currentTime = time / diffTempo;
  let tracksTimer = tracksEndTime.map((trackTime) => ({
    percentage: Math.floor(
      ((currentTime - trackTime.startTime) /
        (trackTime.endTime - trackTime.startTime)) *
        100
    ),
    timer: Math.floor(trackTime.endTime - currentTime),
    startTime: trackTime.startTime,
  }));

  const activeTrack = tracksTimer
    .sort((a, b) => a.timer - b.timer)
    .find((timer) => timer.timer > 0);

  if (activeTrack?.startTime > currentTime) {
    return server.emit(
      "abletonToTimer",
      templateSocketEmit("timerData", { tracksTimer: [tempTrack] })
    );
  }

  server.emit(
    "abletonToTimer",
    templateSocketEmit("timerData", { tracksTimer })
  );
};

// startup
initAbleton();
