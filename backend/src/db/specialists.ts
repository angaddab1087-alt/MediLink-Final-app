/**
 * Every MediLink hospital has all ten clinical departments, so symptom routing always finds a doctor.
 * The five original demo doctors (Dr. A to Dr. Y) stay; these specialists fill the remaining departments,
 * plus a second General Physician. The app (frontend/www/medilink-device.js) builds the same list.
 */
export const ALL_CLINICAL = ['General Physician', 'Orthopaedics', 'Cardiology', 'Paediatrics', 'Gynaecology', 'ENT', 'Dermatology', 'Dental', 'Ophthalmology', 'Gastroenterology'];
const NAMES = [
  ['Neha Kulkarni', 'F'], ['Rahul Deshpande', 'M'], ['Priya Iyer', 'F'], ['Sameer Joshi', 'M'], ['Anjali Mehta', 'F'], ['Vikram Rao', 'M'],
  ['Kavita Nair', 'F'], ['Arjun Patil', 'M'], ['Sneha Gokhale', 'F'], ['Rohit Bhosale', 'M'], ['Pooja Shah', 'F'], ['Aditya Kamath', 'M'],
  ['Meera Pillai', 'F'], ['Nikhil Sawant', 'M'], ['Ritu Agarwal', 'F'], ['Karan Malhotra', 'M'], ['Shweta Pawar', 'F'], ['Manish Gupta', 'M'],
  ['Divya Menon', 'F'], ['Siddharth Jain', 'M'], ['Asha Reddy', 'F'], ['Varun Chavan', 'M'], ['Nisha Kapoor', 'F'], ['Amit Shinde', 'M'],
  ['Swati Bhat', 'F'], ['Gaurav Naik', 'M'], ['Rekha Banerjee', 'F'], ['Tushar More', 'M'], ['Lata Hegde', 'F'], ['Harish Verma', 'M'],
];
export function specialistsFor(slug: string, hIdx: number, existing: string[]) {
  const depts = ['General Physician'].concat(ALL_CLINICAL.filter((d) => !existing.includes(d)));
  return depts.map((department, i) => {
    const [name, g] = NAMES[(hIdx * 6 + i) % NAMES.length];
    return { name: `Dr. ${name}`, email: `dr.${name.split(' ')[0].toLowerCase()}.${slug}@gmail.com`, department, gender: g === 'F' ? 'Female' : 'Male', reg: `MMC-202${hIdx}-${200 + i} (Demo)` };
  });
}
