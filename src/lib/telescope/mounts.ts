/**
 * "What mount do you have?": the best way to connect each family of GoTo mounts, so nobody has
 * to know protocol names. Every route ends in one of the app's connections (NINA, ASCOM Alpaca,
 * INDI, USB cable, network through the bridge). Where a maker's own network protocol is not
 * documented or not verified, the route goes through ASCOM or INDI, which the maker supports.
 */
import type { AdapterKind } from './types';
import type { SerialProtocol } from './serial';

export interface MountRoute {
  kind: AdapterKind;
  /** Short name of the route. */
  label: string;
  protocol?: SerialProtocol;
  /** Default port of the device (network routes: the mount's own port, given to the bridge). */
  devicePort?: number;
  steps: string[];
}

export interface MountFamily {
  id: string;
  name: string;
  routes: MountRoute[];
  note?: string;
}

const NINA: MountRoute = {
  kind: 'nina',
  label: 'Through NINA (best for imaging: plate-solve centring, sequences)',
  steps: [
    'Connect the mount in NINA as usual (Equipment → Mount).',
    'In NINA: Plugins → Available → install "Advanced API", restart, switch it on (port 1888).',
    'Here: pick NINA, type the NINA computer’s address, Connect.',
  ],
};
const ALPACA: MountRoute = {
  kind: 'alpaca',
  label: 'Through ASCOM (Windows): ASCOM Remote / Alpaca',
  steps: [
    'Install the maker’s ASCOM driver and connect the mount with it once.',
    'Start ASCOM Remote (port 11111) and allow cross-origin requests (CORS, origins *) in its setup.',
    'Here: pick ASCOM Alpaca, type that computer’s address and the device number (usually 0), Connect.',
  ],
};
const INDI: MountRoute = {
  kind: 'indi',
  label: 'Through INDI (Linux, Raspberry Pi, StellarMate, Astroberry, KStars/Ekos)',
  steps: [
    'Run indiserver with your mount’s INDI driver (or start Ekos in KStars).',
    'On that computer run the bridge: node tools/bridge/bridge.mjs --dist dist --indi 127.0.0.1:7624 (add --allow-control for GoTo).',
    'Open http://<that computer>:8080 here and tick "Through the bridge", or type its address. Pick INDI, Connect.',
  ],
};
const usb = (protocol: SerialProtocol, extra: string): MountRoute => ({
  kind: 'serial',
  protocol,
  label: `USB cable straight from this computer (${protocol === 'lx200' ? 'LX200' : 'NexStar'} protocol)`,
  steps: [
    extra,
    'Use Chrome or Edge on a computer. Close NINA, ASCOM drivers or the maker’s app first (only one program can use the port).',
    'Here: pick USB cable, Connect, choose the port.',
  ],
});
const net = (protocol: SerialProtocol, port: number, extra: string): MountRoute => ({
  kind: 'network',
  protocol,
  devicePort: port,
  label: `Wi-Fi / network through the bridge (${protocol === 'lx200' ? 'LX200' : 'NexStar'}, port ${port})`,
  steps: [
    extra,
    `On a computer on the same network run the bridge: node tools/bridge/bridge.mjs --dist dist --tcp <mount address>:${port} --tcp-protocol ${protocol} (add --allow-control for GoTo).`,
    'Here: pick Network mount, tick "Through the bridge" (or type the bridge computer’s address), Connect.',
  ],
});

export const MOUNTS: MountFamily[] = [
  {
    id: 'zwo',
    name: 'ZWO AM3 / AM5 / AM7',
    routes: [
      usb('lx200', 'Plug the mount’s USB port into this computer (no hand controller needed).'),
      net('lx200', 4030, 'Join the mount’s Wi-Fi (or put it on your network in the ASIMount app).'),
      NINA,
      ALPACA,
      INDI,
    ],
    note: 'ZWO’s ASIAIR is closed: it cannot be controlled from other apps.',
  },
  {
    id: 'skywatcher',
    name: 'Sky-Watcher (EQ6-R, HEQ5, EQ8, EQM-35, AZ-EQ6, Star Adventurer GTi, AZ-GTi, Wave)',
    routes: [
      usb(
        'nexstar',
        'Plug the SynScan hand controller’s USB port (or its serial cable with a USB adapter) into this computer.',
      ),
      NINA,
      ALPACA,
      INDI,
    ],
    note: 'Wi-Fi-only mounts (AZ-GTi, SA GTi): connect through ASCOM (SynScan App driver) or INDI.',
  },
  {
    id: 'celestron',
    name: 'Celestron (CGX, CGEM II, AVX, Advanced VX, NexStar SE / Evolution, CPC)',
    routes: [
      usb(
        'nexstar',
        'Plug the NexStar+ hand controller’s USB port (or its serial port with an adapter) into this computer.',
      ),
      NINA,
      ALPACA,
      INDI,
    ],
    note: 'Wi-Fi (SkyPortal, StarSense, Evolution): use Celestron CPWI with ASCOM, or INDI.',
  },
  {
    id: 'meade',
    name: 'Meade (LX200, LX600, LX90, LX85, ETX with Autostar)',
    routes: [
      usb(
        'lx200',
        'Connect the Autostar/AudioStar port with Meade’s serial cable and a USB adapter.',
      ),
      NINA,
      ALPACA,
      INDI,
    ],
  },
  {
    id: 'onstep',
    name: 'OnStep / OnStepX (DIY)',
    routes: [
      usb('lx200', 'Plug the controller’s USB port into this computer.'),
      net('lx200', 9999, 'Use the OnStep Smart Web Server on your Wi-Fi.'),
      NINA,
      ALPACA,
      INDI,
    ],
  },
  {
    id: 'ioptron',
    name: 'iOptron (CEM26, CEM40, CEM70, CEM120, GEM28, GEM45, HEM27, HEM44)',
    routes: [NINA, ALPACA, INDI],
    note: 'iOptron uses its own command set: connect with iOptron Commander (ASCOM) or the INDI iOptron driver.',
  },
  {
    id: 'tenmicron',
    name: '10Micron (GM1000, GM2000, GM3000, GM4000)',
    routes: [net('lx200', 3490, 'Put the mount on your network (Ethernet).'), NINA, ALPACA, INDI],
  },
  {
    id: 'other',
    name: 'Any other GoTo mount (Losmandy, Rainbow, Pegasus NYX, Avalon, Paramount, EQMOD…)',
    routes: [ALPACA, INDI, NINA],
    note: 'Every mount with an ASCOM or INDI driver works through those routes.',
  },
];
