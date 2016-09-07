import { ActionReducer, Action } from '@ngrx/store';
import { List, Map, Repeat } from 'immutable';
import { AppStateRecord, appStateFactory } from './app-state.model';
import { ModuleRecord, moduleFactory } from './module.model';
import { NoteRecord, noteFactory } from './note.model';
import { Player, PlayerRecord, playerFactory } from './player.model';
import { PlayerStateRecord, playerStateFactory} from './player-state.model';
import { PlaylistRecord, playlistFactory} from './playlist.model';
import { PlaylistItemRecord, playlistItemFactory } from './playlist-item.model';
import { PlayerStatsRecord, playerStatsFactory } from './player-stats.model';
import { PULSE, ADVANCE, ADJUST_PAN } from './actions';

const GRACENOTE_DURATION = 0.15;
const ADVANCEMENT_DECAY_FACTORY = 0.95;

function generateHues(score: ModuleRecord[]) {
  const wrapHue = (n: number) => n % 256;
  return score.reduce((hues, mod) => {
    const direction = Math.random() < 0.5 ? -1 : 1;
    let hue: number;
    if (hues.length) {
      if (mod.changeHue) {
        hue = wrapHue(hues[hues.length - 1] - direction * Math.floor(256 / 3));
      } else {
        hue = wrapHue(hues[hues.length - 1] - direction * 10);
      }
    } else {
      hue = 227;
    }
    return hues.concat(hue);
  }, []);
}

function readScore(fullScore: ModuleRecord[]): List<ModuleRecord> {
  const hues = generateHues(fullScore);
  return List(fullScore.map(({number, score}, idx) => moduleFactory({
    number,
    score: <List<NoteRecord>>List(score.map(noteFactory)),
    hue: hues[idx]
  })));
}

function getPulsesUntilStart(score: List<NoteRecord>, noteIdx: number) {
  return score
    .take(noteIdx)
    .reduce((sum, note) => sum + note.duration, 0);
}

function makePlaylistItems(note: NoteRecord, noteIdx: number, score: List<NoteRecord>, hue: number, bpm: number, startTime: number) {
  const pulseDuration = 60 / bpm;
  let items = List.of();
  if (note.note) {
    const attackAt = startTime + getPulsesUntilStart(score, noteIdx) * pulseDuration;
    const releaseAt = attackAt + pulseDuration * note.duration;
    items = items.push(playlistItemFactory({
      note: note.note,
      attackAt,
      releaseAt,
      hue
    }));
    if (note.gracenote) {
      items = items.push(playlistItemFactory({
        note: note.gracenote,
        attackAt: attackAt - pulseDuration * GRACENOTE_DURATION,
        releaseAt: attackAt,
        hue
      }))
    }
  }
  return items;
}

function makePlaylist(playerState: PlayerStateRecord, mod: ModuleRecord, startTime: number, beat: number, bpm: number) {
  const pulseDuration = 60 / bpm;
  const items = mod.score.reduce((playlist, note, idx) => {
    return <List<PlaylistItemRecord>>playlist.concat(makePlaylistItems(note, idx, mod.score, mod.hue, bpm, startTime));
  }, playerState.playlist ? playerState.playlist.items : <List<PlaylistItemRecord>>List.of());
  const duration = mod.score.reduce((sum, note) => sum + note.duration, 0);
  return playlistFactory({
    items,
    lastBeat: beat + duration,
    imperfectionDelay: -0.005 + Math.random() * 0.01
  });
}

function canAdvance(playerState: PlayerStateRecord, score: List<ModuleRecord>, beat: number, playerStats: PlayerStatsRecord) {
  if (!playerState.playlist) {
    const isEveryoneAtLastBeat = playerStats.maxTimeToLastBeat <= 1; // First module played in unison
    return isEveryoneAtLastBeat;
  } else {
    const hasMoreModules = playerState.moduleIndex + 1 < score.size;
    const hasEveryoneStarted = playerStats.minModuleIndex >= 0;
    return hasMoreModules && hasEveryoneStarted;
  }
}

function assignModule(playerState: PlayerStateRecord, score: List<ModuleRecord>, beat: number, playerStats: PlayerStatsRecord) {
  if (canAdvance(playerState, score, beat, playerStats)) {
    return playerState.merge({
      moduleIndex: playerState.moduleIndex + 1,
      advanceFactor: playerState.advanceFactor * 1 / Math.pow(ADVANCEMENT_DECAY_FACTORY, playerStats.playerCount)
    });
  } else {
    return playerState;
  }
}

function assignPlaylist(playerState: PlayerStateRecord, score: List<ModuleRecord>, time: number, beat: number, bpm: number) {
  const shouldBePlaying = playerState.moduleIndex >= 0;
  const hasNothingToPlay = !playerState.playlist || Math.floor(playerState.playlist.lastBeat) <= beat;
  if (shouldBePlaying && hasNothingToPlay) {
    const startPlaylistAfterBeat = playerState.playlist ? playerState.playlist.lastBeat : beat;
    const playlist = makePlaylist(playerState, score.get(playerState.moduleIndex), time, startPlaylistAfterBeat, bpm);
    return playerState.merge({playlist});
  } else {
    return playerState;
  }
}

function assignNowPlaying(player: PlayerStateRecord, time: number, bpm: number) {
  if (player.playlist) {
    const pulseDuration = 60 / bpm;
    const nowPlaying = player.playlist && player.playlist.items
      .takeWhile(itm => itm.attackAt < time + pulseDuration)
      .map(itm => itm.update('attackAt', a => a + player.playlist.imperfectionDelay));
    return player
      .set('nowPlaying', nowPlaying)
      .updateIn(['playlist', 'items'], itms => itms.skip(nowPlaying.size));
  } else {
    return player;
  }
}

function updatePlaylists(state: AppStateRecord, time: number, bpm: number) {
  const {score, beat} = state;
  const players = state.players
    .map(player => assignPlaylist(player, score, time, beat, bpm))
    .map(player => assignNowPlaying(player, time, bpm))
  return state.merge({players});
}

function updatePlayerStats(state: AppStateRecord) {
  const mods = state.players.map(p => p.moduleIndex);
  const timesToLastBeat = state.players.map(p => p.playlist ? p.playlist.lastBeat - state.beat : 0);
  return state.mergeIn(['stats'], {
    minModuleIndex: mods.min(),
    maxModuleIndex: mods.max(),
    minTimeToLastBeat: timesToLastBeat.min(),
    maxTimeToLastBeat: timesToLastBeat.max()
  });
}

function advancePlayer(state: AppStateRecord, instrument: string) {
  const playerIdx = state.players.findIndex(p => p.player.instrument === instrument);
  const {score, beat, stats} = state;
  if (canAdvance(state.players.get(playerIdx), score, beat, state.stats)) {
    const players = state.players
      .update(playerIdx, player => assignModule(player, score, beat, stats))
      .map(player => decayAdvancementFactor(player));
    return state.merge({players});
  } else {
    return state;
  }
}

function decayAdvancementFactor(playerState: PlayerStateRecord) {
  const advanceFactor = playerState.advanceFactor * ADVANCEMENT_DECAY_FACTORY;
  return playerState.merge({advanceFactor});
}

const initialPlayerStates = List((<Player[]>require('json!../../ensemble.json'))
  .map((p: Player) => playerStateFactory({
    player: playerFactory(p),
    moduleIndex: -1,
    advanceFactor: 1,
    pan: Math.random() * 2 - 1,
    y: Math.random() * 2 - 1
  }))
);

const initialState = appStateFactory({
  score: readScore(require('json!../../score.json')),
  beat: 0,
  players: initialPlayerStates,
  stats: playerStatsFactory().merge({playerCount: initialPlayerStates.size})
});

export const appReducer: ActionReducer<AppStateRecord> = (state = initialState, action: Action) => {
  switch (action.type) {
    case PULSE:
      const nextBeat = state.beat + 1;
      return updatePlayerStats(updatePlaylists(state.set('beat', nextBeat), action.payload.time, action.payload.bpm));
    case ADVANCE:
      return advancePlayer(state, action.payload);
    case ADJUST_PAN:
      const playerIdxForPan = state.players
        .findIndex(p => p.player.instrument === action.payload.instrument);
      // Todo: could use mergeIn but there's a bug in immutable typescript definitions 
      return state
        .setIn(['players', playerIdxForPan, 'pan'], Math.min(1, Math.max(-1, action.payload.pan)))
        .setIn(['players', playerIdxForPan, 'y'], action.payload.y);
    default:
      return state;
  }
}