/**
 * F1 devre verileri
 * Koordinatlar, uzunluk, tur rekoru, DRS bölgesi sayısı, viraj sayısı
 */

export interface CircuitInfo {
  name: string
  country: string
  locality: string
  lat: number
  lng: number
  lengthKm: number
  corners: number
  drsZones: number
  lapRecord: { time: string; driver: string; year: number } | null
  firstGP: number
  timezone: string
}

export const CIRCUIT_DATA: Record<string, CircuitInfo> = {
  'Australian Grand Prix': {
    name: 'Albert Park Grand Prix Circuit', country: 'Australia', locality: 'Melbourne',
    lat: -37.8497, lng: 144.968, lengthKm: 5.278, corners: 16, drsZones: 4,
    lapRecord: { time: '1:20.235', driver: 'Charles Leclerc', year: 2022 },
    firstGP: 1996, timezone: 'Australia/Melbourne',
  },
  'Chinese Grand Prix': {
    name: 'Shanghai International Circuit', country: 'China', locality: 'Shanghai',
    lat: 31.3389, lng: 121.2198, lengthKm: 5.451, corners: 16, drsZones: 2,
    lapRecord: { time: '1:32.238', driver: 'Michael Schumacher', year: 2004 },
    firstGP: 2004, timezone: 'Asia/Shanghai',
  },
  'Japanese Grand Prix': {
    name: 'Suzuka Circuit', country: 'Japan', locality: 'Suzuka',
    lat: 34.8431, lng: 136.5407, lengthKm: 5.807, corners: 18, drsZones: 2,
    lapRecord: { time: '1:30.983', driver: 'Lewis Hamilton', year: 2019 },
    firstGP: 1987, timezone: 'Asia/Tokyo',
  },
  'Bahrain Grand Prix': {
    name: 'Bahrain International Circuit', country: 'Bahrain', locality: 'Sakhir',
    lat: 26.0325, lng: 50.5106, lengthKm: 5.412, corners: 15, drsZones: 3,
    lapRecord: { time: '1:31.447', driver: 'Pedro de la Rosa', year: 2005 },
    firstGP: 2004, timezone: 'Asia/Bahrain',
  },
  'Saudi Arabian Grand Prix': {
    name: 'Jeddah Corniche Circuit', country: 'Saudi Arabia', locality: 'Jeddah',
    lat: 21.6321, lng: 39.1044, lengthKm: 6.174, corners: 27, drsZones: 3,
    lapRecord: { time: '1:30.734', driver: 'Lewis Hamilton', year: 2021 },
    firstGP: 2021, timezone: 'Asia/Riyadh',
  },
  'Miami Grand Prix': {
    name: 'Miami International Autodrome', country: 'USA', locality: 'Miami',
    lat: 25.9581, lng: -80.2389, lengthKm: 5.412, corners: 19, drsZones: 3,
    lapRecord: { time: '1:29.708', driver: 'Max Verstappen', year: 2023 },
    firstGP: 2022, timezone: 'America/New_York',
  },
  'Canadian Grand Prix': {
    name: 'Circuit Gilles Villeneuve', country: 'Canada', locality: 'Montreal',
    lat: 45.5, lng: -73.5228, lengthKm: 4.361, corners: 14, drsZones: 2,
    lapRecord: { time: '1:13.078', driver: 'Valtteri Bottas', year: 2019 },
    firstGP: 1978, timezone: 'America/Toronto',
  },
  'Monaco Grand Prix': {
    name: 'Circuit de Monaco', country: 'Monaco', locality: 'Monte Carlo',
    lat: 43.7347, lng: 7.4204, lengthKm: 3.337, corners: 19, drsZones: 1,
    lapRecord: { time: '1:12.909', driver: 'Lewis Hamilton', year: 2021 },
    firstGP: 1950, timezone: 'Europe/Monaco',
  },
  'Spanish Grand Prix': {
    name: 'Circuito de Madrid Jarama', country: 'Spain', locality: 'Madrid',
    lat: 40.45, lng: -3.73, lengthKm: 5.07, corners: 20, drsZones: 3,
    lapRecord: null, firstGP: 2026, timezone: 'Europe/Madrid',
  },
  'Barcelona Grand Prix': {
    name: 'Circuit de Barcelona-Catalunya', country: 'Spain', locality: 'Barcelona',
    lat: 41.57, lng: 2.26, lengthKm: 4.675, corners: 16, drsZones: 2,
    lapRecord: { time: '1:18.149', driver: 'Max Verstappen', year: 2023 },
    firstGP: 1991, timezone: 'Europe/Madrid',
  },
  'Austrian Grand Prix': {
    name: 'Red Bull Ring', country: 'Austria', locality: 'Spielberg',
    lat: 47.2197, lng: 14.7647, lengthKm: 4.318, corners: 10, drsZones: 3,
    lapRecord: { time: '1:05.619', driver: 'Carlos Sainz', year: 2020 },
    firstGP: 1970, timezone: 'Europe/Vienna',
  },
  'British Grand Prix': {
    name: 'Silverstone Circuit', country: 'Great Britain', locality: 'Silverstone',
    lat: 52.0786, lng: -1.0169, lengthKm: 5.891, corners: 18, drsZones: 2,
    lapRecord: { time: '1:27.097', driver: 'Max Verstappen', year: 2020 },
    firstGP: 1950, timezone: 'Europe/London',
  },
  'Belgian Grand Prix': {
    name: 'Circuit de Spa-Francorchamps', country: 'Belgium', locality: 'Spa',
    lat: 50.4372, lng: 5.9714, lengthKm: 7.004, corners: 20, drsZones: 2,
    lapRecord: { time: '1:46.286', driver: 'Valtteri Bottas', year: 2018 },
    firstGP: 1950, timezone: 'Europe/Brussels',
  },
  'Hungarian Grand Prix': {
    name: 'Hungaroring', country: 'Hungary', locality: 'Budapest',
    lat: 47.5789, lng: 19.2486, lengthKm: 4.381, corners: 14, drsZones: 2,
    lapRecord: { time: '1:16.627', driver: 'Lewis Hamilton', year: 2020 },
    firstGP: 1986, timezone: 'Europe/Budapest',
  },
  'Dutch Grand Prix': {
    name: 'Circuit Zandvoort', country: 'Netherlands', locality: 'Zandvoort',
    lat: 52.3888, lng: 4.5409, lengthKm: 4.259, corners: 14, drsZones: 2,
    lapRecord: { time: '1:11.097', driver: 'Lewis Hamilton', year: 2021 },
    firstGP: 1952, timezone: 'Europe/Amsterdam',
  },
  'Italian Grand Prix': {
    name: 'Autodromo Nazionale Monza', country: 'Italy', locality: 'Monza',
    lat: 45.6156, lng: 9.2811, lengthKm: 5.793, corners: 11, drsZones: 2,
    lapRecord: { time: '1:21.046', driver: 'Rubens Barrichello', year: 2004 },
    firstGP: 1950, timezone: 'Europe/Rome',
  },
  'Azerbaijan Grand Prix': {
    name: 'Baku City Circuit', country: 'Azerbaijan', locality: 'Baku',
    lat: 40.3724, lng: 49.8533, lengthKm: 6.003, corners: 20, drsZones: 2,
    lapRecord: { time: '1:43.009', driver: 'Charles Leclerc', year: 2019 },
    firstGP: 2017, timezone: 'Asia/Baku',
  },
  'Singapore Grand Prix': {
    name: 'Marina Bay Street Circuit', country: 'Singapore', locality: 'Singapore',
    lat: 1.2914, lng: 103.864, lengthKm: 5.063, corners: 23, drsZones: 3,
    lapRecord: { time: '1:35.867', driver: 'Kevin Magnussen', year: 2018 },
    firstGP: 2008, timezone: 'Asia/Singapore',
  },
  'United States Grand Prix': {
    name: 'Circuit of The Americas', country: 'USA', locality: 'Austin',
    lat: 30.1328, lng: -97.6411, lengthKm: 5.513, corners: 20, drsZones: 2,
    lapRecord: { time: '1:36.169', driver: 'Charles Leclerc', year: 2019 },
    firstGP: 2012, timezone: 'America/Chicago',
  },
  'Mexico City Grand Prix': {
    name: 'Autódromo Hermanos Rodríguez', country: 'Mexico', locality: 'Mexico City',
    lat: 19.4042, lng: -99.0907, lengthKm: 4.304, corners: 17, drsZones: 3,
    lapRecord: { time: '1:17.774', driver: 'Valtteri Bottas', year: 2021 },
    firstGP: 1963, timezone: 'America/Mexico_City',
  },
  'São Paulo Grand Prix': {
    name: 'Autódromo José Carlos Pace', country: 'Brazil', locality: 'São Paulo',
    lat: -23.7036, lng: -46.6997, lengthKm: 4.309, corners: 15, drsZones: 3,
    lapRecord: { time: '1:10.540', driver: 'Valtteri Bottas', year: 2018 },
    firstGP: 1973, timezone: 'America/Sao_Paulo',
  },
  'Las Vegas Grand Prix': {
    name: 'Las Vegas Strip Circuit', country: 'USA', locality: 'Las Vegas',
    lat: 36.1699, lng: -115.1398, lengthKm: 6.201, corners: 17, drsZones: 2,
    lapRecord: { time: '1:35.490', driver: 'Oscar Piastri', year: 2023 },
    firstGP: 2023, timezone: 'America/Los_Angeles',
  },
  'Qatar Grand Prix': {
    name: 'Lusail International Circuit', country: 'Qatar', locality: 'Lusail',
    lat: 25.49, lng: 51.4542, lengthKm: 5.419, corners: 16, drsZones: 2,
    lapRecord: { time: '1:24.319', driver: 'Max Verstappen', year: 2023 },
    firstGP: 2021, timezone: 'Asia/Qatar',
  },
  'Abu Dhabi Grand Prix': {
    name: 'Yas Marina Circuit', country: 'UAE', locality: 'Abu Dhabi',
    lat: 24.4672, lng: 54.603, lengthKm: 5.281, corners: 16, drsZones: 2,
    lapRecord: { time: '1:26.103', driver: 'Max Verstappen', year: 2021 },
    firstGP: 2009, timezone: 'Asia/Dubai',
  },
}

export function getCircuitByRaceName(raceName: string): CircuitInfo | null {
  // Tam eşleşme
  if (CIRCUIT_DATA[raceName]) return CIRCUIT_DATA[raceName]
  // Kısmi eşleşme
  const key = Object.keys(CIRCUIT_DATA).find(k =>
    raceName.toLowerCase().includes(k.toLowerCase().split(' ')[0]) ||
    k.toLowerCase().includes(raceName.toLowerCase().split(' ')[0])
  )
  return key ? CIRCUIT_DATA[key] : null
}
