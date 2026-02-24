// src/commands/voice.js
// COMMAND SHIM - delegates to VoiceMaster UI definition

export const meta = {
  category: "voice",
  guildOnly: true,
  deployGlobal: true,
};

export { data, execute, handleButton, handleSelect, handleModal } from "../tools/voice/commands.js";
