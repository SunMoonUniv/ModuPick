import { useState } from 'react';
// import { ComponentGallery } from './screens/ComponentGallery/ComponentGallery';
import { MainScreen } from './screens/MainScreen/MainScreen';
import { RoomCreateScreen } from './screens/RoomCreateScreen/RoomCreateScreen';
import { ProfileSetupScreen } from './screens/ProfileSetupScreen/ProfileSetupScreen';
import { WaitingRoomScreen } from './screens/WaitingRoomScreen/WaitingRoomScreen';
import { RouletteScreen } from './screens/RouletteScreen/RouletteScreen';
import { RouletteResultScreen } from './screens/RouletteResultScreen/RouletteResultScreen';
import type { Character } from './assets/avatars/characters';

type Screen = 'main' | 'roomCreate' | 'profileSetup' | 'waitingRoom' | 'roulette' | 'rouletteResult';

// 방을 새로 만든 사람인지(host) 초대 코드로 들어온 사람인지(participant) — 대기방 화면의 조작 권한을 가름
type Role = 'host' | 'participant';

// 방 코드 발급 — 실제로는 서버가 중복 없는 코드를 생성해야 하는데, 지금은 서버가 없어 클라이언트에서 임의로 6자리를 만듦(임시)
const generateRoomCode = () => `MODU-${Math.floor(100000 + Math.random() * 900000)}`;

type Winner = { name: string; character: Character };

// 앱 진입점 — 라우팅 라이브러리가 아직 없어 화면 전환을 로컬 상태로만 처리함
function App() {
  const [screen, setScreen] = useState<Screen>('main');
  const [role, setRole] = useState<Role>('host');
  const [roomName, setRoomName] = useState('4조 · 알고리즘 스터디');
  const [roomCode, setRoomCode] = useState('MODU-427132');
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [myNickname, setMyNickname] = useState<string | undefined>();
  const [myCharacter, setMyCharacter] = useState<Character | undefined>();
  const [winner, setWinner] = useState<Winner | undefined>();

  switch (screen) {
    case 'roomCreate':
      return (
        <RoomCreateScreen
          onBack={() => setScreen('main')}
          onCreateRoom={(data) => {
            setRole('host');
            setRoomName(data.name);
            setMaxPlayers(data.maxPlayers);
            setRoomCode(generateRoomCode());
            setScreen('profileSetup');
          }}
        />
      );
    case 'profileSetup':
      return (
        <ProfileSetupScreen
          onBack={() => setScreen(role === 'host' ? 'roomCreate' : 'main')}
          onEnterRoom={(profile) => {
            setMyNickname(profile.nickname);
            setMyCharacter(profile.character);
            setScreen('waitingRoom');
          }}
        />
      );
    case 'waitingRoom':
      return (
        <WaitingRoomScreen
          role={role}
          roomName={roomName}
          roomCode={roomCode}
          maxPlayers={maxPlayers}
          myNickname={myNickname}
          myCharacter={myCharacter}
          onExit={() => setScreen('main')}
          onStartGame={() => setScreen('roulette')}
        />
      );
    case 'roulette':
      return <RouletteScreen onSpinComplete={(w) => { setWinner(w); setScreen('rouletteResult'); }} />;
    case 'rouletteResult':
      return (
        <RouletteResultScreen
          winnerName={winner?.name}
          winnerCharacter={winner?.character}
          onReplay={() => setScreen('roulette')}
          onBackToWaitingRoom={() => setScreen('waitingRoom')}
        />
      );
    default:
      return (
        <MainScreen
          onCreateRoom={() => setScreen('roomCreate')}
          onJoinRoom={(code) => {
            // 코드가 실제 존재하는 방인지는 서버만 확인할 수 있어, 지금은 형식만 맞춰 그대로 참여자로 진입시킴(임시)
            setRole('participant');
            setRoomCode(`MODU-${code}`);
            setRoomName('참여한 방');
            setScreen('profileSetup');
          }}
        />
      );
  }
  // return <ComponentGallery />;
}

export default App;
