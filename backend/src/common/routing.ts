/**
 * Rule-based symptom routing. It suggests ONE department and never gives a diagnosis.
 * An inverted index maps keywords (English, Hindi, Marathi) to departments with weights.
 */
export const RED_FLAGS = [
  'chest pain', 'chest tightness', 'breathless', 'cannot breathe', "can't breathe", 'shortness of breath',
  'heavy bleeding', 'unconscious', 'fainted', 'seizure', 'fits', 'stroke', 'face drooping', 'slurred speech',
  'severe burn', 'poison', 'suicid', 'accident', 'head injury',
  'सीने में दर्द', 'सांस नहीं', 'बेहोश', 'खून बह', 'छातीत दुखणे', 'श्वास घेता येत नाही', 'बेशुद्ध',
];

type Entry = { dept: string; w: number };
const I: Record<string, Entry[]> = {};
const add = (dept: string, w: number, words: string[]) => words.forEach((k) => (I[k] ||= []).push({ dept, w }));

add('Cardiology', 3, ['palpitation', 'heart', 'bp', 'blood pressure', 'hypertension', 'दिल', 'हृदय', 'धडधड']);
add('Orthopaedics', 3, ['knee', 'joint', 'back pain', 'fracture', 'bone', 'sprain', 'shoulder', 'neck pain', 'घुटना', 'हड्डी', 'गुडघा', 'हाड', 'पाठदुखी']);
add('Paediatrics', 3, ['child', 'baby', 'infant', 'my son', 'my daughter', 'बच्चा', 'बाळ', 'मुलगा', 'मुलगी']);
add('Dermatology', 3, ['rash', 'itch', 'skin', 'acne', 'pimple', 'eczema', 'खुजली', 'त्वचा', 'खाज']);
add('ENT', 3, ['ear', 'throat', 'tonsil', 'sinus', 'nose bleed', 'hearing', 'कान', 'गला', 'घसा']);
add('Ophthalmology', 3, ['eye', 'vision', 'blurred', 'आंख', 'डोळा']);
add('Gynaecology', 3, ['pregnan', 'period', 'menstrual', 'pcos', 'गर्भ', 'मासिक', 'पाळी']);
add('Gastroenterology', 2, ['stomach', 'abdomen', 'vomit', 'diarrhoea', 'diarrhea', 'acidity', 'loose motion', 'पेट', 'उल्टी', 'पोट', 'जुलाब']);
add('General Physician', 1, ['fever', 'cough', 'cold', 'headache', 'weakness', 'body ache', 'बुखार', 'खांसी', 'ताप', 'खोकला', 'डोकेदुखी']);

export const BODY_AREAS: Record<string, string> = {
  Head: 'General Physician', Eyes: 'Ophthalmology', 'Ear, nose, throat': 'ENT', Teeth: 'Dental', Chest: 'Cardiology',
  Stomach: 'Gastroenterology', Back: 'Orthopaedics', 'Arms & legs': 'Orthopaedics', Skin: 'Dermatology',
};

export interface RouteResult { emergency: boolean; department: string; matched: string[]; note: string }

export function routeSymptoms(text: string, bodyArea?: string): RouteResult {
  const t = ` ${(text || '').toLowerCase()} `;
  const note = 'This is a routing suggestion only, not a diagnosis.';
  const red = RED_FLAGS.filter((k) => t.includes(k));
  if (red.length) return { emergency: true, department: 'Emergency', matched: red, note: 'These symptoms may need urgent care. Please go to the emergency desk or use the Emergency button.' };
  const score: Record<string, number> = {};
  const matched: string[] = [];
  for (const k of Object.keys(I)) {
    if (t.includes(k)) { matched.push(k); for (const e of I[k]) score[e.dept] = (score[e.dept] || 0) + e.w; }
  }
  if (bodyArea && BODY_AREAS[bodyArea]) score[BODY_AREAS[bodyArea]] = (score[BODY_AREAS[bodyArea]] || 0) + 2;
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return { emergency: false, department: best ? best[0] : 'General Physician', matched, note };
}

/** Distance in km between two points (haversine). */
export function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export const EMERGENCY_RINGS_KM = [5, 10, 25, 50];
