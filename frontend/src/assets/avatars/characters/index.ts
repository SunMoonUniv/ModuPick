// 플레이 가능한 캐릭터 30종 — Figma 618:5799 타일 데모에서 위→아래로 나열된 순서대로 번호 부여
import corgiSpaceCaptain from './01-corgi-space-captain.png';
import slothKing from './02-sloth-king.png';
import catGamer from './03-cat-gamer.png';
import alpacaDiva from './04-alpaca-diva.png';
import penguinDj from './05-penguin-dj.png';
import goatPunk from './06-goat-punk.png';
import crocodileLifeguard from './07-crocodile-lifeguard.png';
import hyena from './08-hyena.png';
import goblinShark from './09-goblin-shark.png';
import platypusMechanic from './10-platypus-mechanic.png';
import octopus from './11-octopus.png';
import rabbitSpeedster from './12-rabbit-speedster.png';
import cowChef from './13-cow-chef.png';
import redPandaThief from './14-red-panda-thief.png';
import hamsterWrestler from './15-hamster-wrestler.png';
import raccoonHacker from './16-raccoon-hacker.png';
import sealClown from './17-seal-clown.png';
import crabBoxer from './18-crab-boxer.png';
import owlProfessor from './19-owl-professor.png';
import snailCourier from './20-snail-courier.png';
import nakedMoleRat from './21-naked-mole-rat.png';
import pufferfish from './22-pufferfish.png';
import axolotl from './23-axolotl.png';
import pigeonOfficeBoss from './24-pigeon-office-boss.png';
import bat from './25-bat.png';
import capybara from './26-capybara.png';
import chameleonWizard from './27-chameleon-wizard.png';
import frogComedian from './28-frog-comedian.png';
import boarBiker from './29-boar-biker.png';
import duckDetective from './30-duck-detective.png';

export type Character = {
  id: number;
  name: string;
  image: string;
  /** 선택 가능(available) 상태의 카드 배경색 — Figma 618:5799 실측, 캐릭터 고유색이 아니라 순환 팔레트 */
  tint: string;
};

export const CHARACTERS: Character[] = [
  // tint는 실제 화면 노드 542:5739 실측값
  { id: 1, name: 'corgi-space-captain', image: corgiSpaceCaptain, tint: '#ffe23e' },
  { id: 2, name: 'sloth-king', image: slothKing, tint: '#ff4fd4' },
  { id: 3, name: 'cat-gamer', image: catGamer, tint: '#ff8c8c' },
  { id: 4, name: 'alpaca-diva', image: alpacaDiva, tint: '#ffc780' },
  { id: 5, name: 'penguin-dj', image: penguinDj, tint: '#80bfff' },
  { id: 6, name: 'goat-punk', image: goatPunk, tint: '#73e5e5' },
  { id: 7, name: 'crocodile-lifeguard', image: crocodileLifeguard, tint: '#ccf26b' },
  { id: 8, name: 'hyena', image: hyena, tint: '#80ebbf' },
  { id: 9, name: 'goblin-shark', image: goblinShark, tint: '#b899ff' },
  { id: 10, name: 'platypus-mechanic', image: platypusMechanic, tint: '#73e5e5' },
  { id: 11, name: 'octopus', image: octopus, tint: '#ff4fd4' },
  { id: 12, name: 'rabbit-speedster', image: rabbitSpeedster, tint: '#80ebbf' },
  { id: 13, name: 'cow-chef', image: cowChef, tint: '#007aff' },
  { id: 14, name: 'red-panda-thief', image: redPandaThief, tint: '#772727' },
  { id: 15, name: 'hamster-wrestler', image: hamsterWrestler, tint: '#f5e4a0' },
  { id: 16, name: 'raccoon-hacker', image: raccoonHacker, tint: '#8cd3ff' },
  { id: 17, name: 'seal-clown', image: sealClown, tint: '#ccf26b' },
  { id: 18, name: 'crab-boxer', image: crabBoxer, tint: '#ff6062' },
  { id: 19, name: 'owl-professor', image: owlProfessor, tint: '#9f894c' },
  { id: 20, name: 'snail-courier', image: snailCourier, tint: '#e9e566' },
  { id: 21, name: 'naked-mole-rat', image: nakedMoleRat, tint: '#ff4fd4' },
  { id: 22, name: 'pufferfish', image: pufferfish, tint: '#eaff4f' },
  { id: 23, name: 'axolotl', image: axolotl, tint: '#ff4fd4' },
  { id: 24, name: 'pigeon-office-boss', image: pigeonOfficeBoss, tint: '#8a9adb' },
  { id: 25, name: 'bat', image: bat, tint: '#ff8c8c' },
  { id: 26, name: 'capybara', image: capybara, tint: '#e3800f' },
  { id: 27, name: 'chameleon-wizard', image: chameleonWizard, tint: '#ff87e1' },
  { id: 28, name: 'frog-comedian', image: frogComedian, tint: '#c157e4' },
  { id: 29, name: 'boar-biker', image: boarBiker, tint: '#ccf26b' },
  { id: 30, name: 'duck-detective', image: duckDetective, tint: '#7fca46' },
];
