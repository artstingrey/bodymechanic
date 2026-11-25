import 'server-only';

import homeMassage from '../../public/website-services/Home-service.png';
import iceBathAfterMassage from '../../public/website-services/ice-bath.png';
import iceBath from '../../public/website-services/Individual-Ice-Bath-session+infrared-capsule.png';
import sportsMassage from '../../public/website-services/sports-massage.png';
import classicMassage from '../../public/website-services/classic-massage.png';
import thaiMassage from '../../public/website-services/thai-massage.png';
import infrared30 from '../../public/website-services/infrared.png';
import infrared45 from '../../public/website-services/infrared-2.png';
import sportsInfrared from '../../public/website-services/sports-massage+capsule.png';
import classicInfrared from '../../public/website-services/classic-massage+capsule.png';
import thaiInfrared from '../../public/website-services/thai-massage+capsule.png';
import functionalTraining from '../../public/website-services/Functional-Training-&-Mobility.png';
import deepBodywork from '../../public/website-services/Deep-Bodywork+infrared-capsule.png';
import sportsConditioning from '../../public/website-services/Sports-Conditioning-&-Mobility.png';
import muscleFasciaWork from '../../public/website-services/Muscle-&-Fascia-Work+Stretching.png';

// Next.js regenerates the asset URL when an imported photo's content changes.
const servicePhotos = new Map([
  [13688504, homeMassage],
  [13706788, classicMassage],
  [13982351, iceBathAfterMassage],
  [13982353, iceBath],
  [13982355, sportsMassage],
  [13982356, classicMassage],
  [13982358, thaiMassage],
  [13982363, infrared30],
  [13982369, infrared45],
  [13982379, sportsInfrared],
  [13982380, classicInfrared],
  [13982382, thaiInfrared],
  [13983057, functionalTraining],
  [13983060, deepBodywork],
  [13983065, sportsConditioning],
  [13983067, muscleFasciaWork],
]);

export function catalogServicePhoto(serviceId: number) {
  const photo = servicePhotos.get(serviceId);
  // Vercel resolves the static asset URL after decoding the optimizer's url parameter.
  return photo && { ...photo, src: photo.src.replace(/[+&]/g, (character) => encodeURIComponent(character)) };
}
