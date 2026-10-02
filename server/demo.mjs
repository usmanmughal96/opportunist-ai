// DEMO MODE dataset. Clearly labelled sample data used when live connectors/credentials are unavailable.
// Company names are well-known public employers; signals are ILLUSTRATIVE and must be verified before use.
// No people names or personal contact data are included — people lookup is a human-in-the-loop step.
import { scoreCompany } from './agent.mjs';

const d = (company, industry, role, website, careersUrl, source, sourceWeight, signals, description, opportunityType = 'Job') => ({
  company, industry, role, website, careersUrl, city: 'Amsterdam', country: 'Netherlands', sources: [source], source,
  sourceUrls: [careersUrl], sourceWeight, signals, description, opportunityType, updatedAt: new Date(Date.now() - Math.random() * 40 * 86400000).toISOString(),
});

const SEED = [
  d('Optiver', 'Trading / Market making', 'Software Engineer — Low-latency C++', 'https://optiver.com', 'https://optiver.com/working-at-optiver/career-opportunities/', 'University career fair (sample)', 10, ['Careers page linked from company website', 'Active vacancy (sample)'], 'Market maker; C++ and Python trading systems; international graduate hiring, relocation support.'),
  d('IMC Trading', 'Trading / Quant', 'Quant Developer — Python', 'https://www.imc.com', 'https://www.imc.com/eu/careers', 'Trading ecosystem (sample)', 10, ['Careers page linked from company website', 'Uses ATS: greenhouse.io'], 'Proprietary trading firm; Python, C++, FPGA; international team, English working language.'),
  d('Flow Traders', 'Trading / ETFs & crypto', 'Crypto Trading Systems Engineer', 'https://www.flowtraders.com', 'https://www.flowtraders.com/careers', 'Exchange ecosystem (sample)', 10, ['Careers page linked from company website', 'Hiring signal: crypto desk (sample)'], 'Liquidity provider in ETFs and crypto assets; C++ and Python; relocation support.'),
  d('Da Vinci Trading', 'Trading / Derivatives', 'Graduate Software Developer', 'https://davincitrading.com', 'https://davincitrading.com/careers', 'Career-fair employer PDF (sample)', 10, ['Careers page linked from company website', 'Active vacancy (sample)'], 'Derivatives trading; Python and C++; graduate programme, international hiring.'),
  d('Adyen', 'Fintech / Payments', 'Backend Engineer — Python/Java', 'https://www.adyen.com', 'https://careers.adyen.com', 'Hackathon sponsor (sample)', 9, ['Careers page linked from company website', 'Uses ATS: greenhouse.io'], 'Global payments platform; Python and Java; visa sponsorship mentioned on careers site.'),
  d('Bitvavo', 'Crypto exchange', 'Senior Rust / C++ Matching Engine Engineer', 'https://bitvavo.com', 'https://bitvavo.com/en/careers', 'X / Twitter hiring post (sample)', 8, ['Hiring signal: engineering vacancy (sample)', 'Uses ATS: recruitee.com'], 'European crypto exchange; Rust, C++, Python; international team.'),
  d('Mollie', 'Fintech', 'Machine Learning Engineer — Fraud', 'https://www.mollie.com', 'https://jobs.mollie.com', 'VC portfolio (sample)', 9, ['Careers page linked from company website', 'Active vacancy (sample)'], 'Payments scale-up; Python, ML; English-speaking, relocation.'),
  d('Booking.com', 'Travel tech / AI', 'ML Scientist — Recommendation', 'https://www.booking.com', 'https://jobs.booking.com', 'Conference exhibitor (sample)', 7, ['Careers page linked from company website', 'Uses ATS: workday'], 'Large-scale AI and experimentation; Python, ML; international relocation.'),
  d('Picnic', 'E-commerce / Logistics', 'Python Software Engineer', 'https://picnic.app', 'https://picnic.app/careers', 'University career portal (sample)', 9, ['Careers page linked from company website', 'Hiring signal: graduate programme (sample)'], 'Online grocery with in-house tech; Python, Java; international hiring.'),
  d('bunq', 'Fintech / Neobank', 'AI Engineer', 'https://www.bunq.com', 'https://www.bunq.com/careers', 'Accelerator / startup ecosystem (sample)', 8, ['Careers page linked from company website'], 'Neobank building AI features; Python, ML; relocation.'),
  d('Elastic', 'Open source / Search', 'Software Engineer — Python clients', 'https://www.elastic.co', 'https://www.elastic.co/careers', 'GitHub organizations (sample)', 8, ['Public GitHub org', 'Uses ATS: greenhouse.io'], 'Open-source search company founded in Amsterdam; Python, Java; remote-friendly.', 'Remote job'),
  d('Tiqets', 'Travel tech', 'Data Engineer', 'https://www.tiqets.com', 'https://www.tiqets.com/careers', 'HN Who-is-Hiring (sample)', 9, ['Posted in founder hiring thread (sample)'], 'Scale-up; Python, SQL; English-speaking team.'),
  d('Local: De Pijp Café Group', 'Restaurants / Hospitality', 'Website + booking system (freelance client lead)', '', '', 'Google Maps (sample)', 7, ['Found on Google Maps — no online booking detected (sample)'], 'Local business discovery use case: potential freelance client, not a vacancy.', 'Client lead'),
];

export function demoOpportunities(intent) {
  return SEED.map((c) => scoreCompany({ ...c, signals: [...c.signals] }, intent))
    .sort((a, b) => b.score - a.score)
    .map((o, i) => ({ ...o, id: `demo-${i}`, demo: true }));
}

export const DEMO_SOURCE_EVENTS = [
  ['web_search', 'University career fairs', 'Web Search', 23], ['google_maps', 'Google Maps / Places', 'Google Maps', 41],
  ['github', 'GitHub Organizations', 'GitHub', 12], ['trading', 'Trading & exchange ecosystems', 'Web Search', 18],
  ['hn_hiring', 'HN “Who is Hiring”', 'Hacker News', 9], ['vc', 'VC portfolios & accelerators', 'Web Search', 15],
  ['jobboards', 'Job boards', 'Arbeitnow / Remotive', 27],
];
