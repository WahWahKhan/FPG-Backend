// lib/tube360/contact-validation.js
// Server-side port of the frontend checkout rules in
// frontend lib/checkout/form-validation.ts - the Tube360 "Your details" form
// uses exactly the same rules as checkout, so a customer who can check out can
// also request a quote. Keep the regexes IDENTICAL to the frontend file.

const EMAIL_REGEX = /^[a-zA-Z0-9._]+@[a-zA-Z]{2,}\.[a-zA-Z]{2,}(\.[a-zA-Z]{2,})*$/;
const SUBURB_REGEX = /^[a-zA-Z\s]+$/;
const POSTCODE_REGEX = /^\d{4}$/;
const CONTACT_NUMBER_REGEX = /^\d{10}$/;
const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

const MAX = { name: 80, companyName: 100, address: 200, suburb: 60 };

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Validate + normalise the contact block.
 * @returns {{ ok: true, contact: object } | { ok: false, errors: object }}
 */
function validateContact(input) {
  const c = input || {};
  const contact = {
    name: str(c.name).slice(0, MAX.name),
    companyName: str(c.companyName).slice(0, MAX.companyName),
    address: str(c.address).slice(0, MAX.address),
    suburb: str(c.suburb).slice(0, MAX.suburb),
    state: str(c.state),
    postcode: str(c.postcode),
    email: str(c.email),
    contactNumber: str(c.contactNumber),
  };
  const errors = {};
  if (!contact.name) errors.name = 'This field is required';
  if (!contact.address) errors.address = 'This field is required';
  if (!contact.suburb) errors.suburb = 'This field is required';
  else if (!SUBURB_REGEX.test(contact.suburb)) errors.suburb = 'Please enter letters only';
  if (!STATES.includes(contact.state)) errors.state = 'Please select a state';
  if (!POSTCODE_REGEX.test(contact.postcode)) errors.postcode = 'Please enter 4 digits';
  if (!EMAIL_REGEX.test(contact.email)) errors.email = 'Please enter a valid email address';
  if (!CONTACT_NUMBER_REGEX.test(contact.contactNumber)) errors.contactNumber = 'Contact number must be 10 digits';

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, contact };
}

module.exports = { validateContact };
