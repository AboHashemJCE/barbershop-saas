export const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const isValidPhone = (phone) => {
  return /^\+[1-9]\d{7,14}$/.test(phone);
};

export const isValidSlug = (slug) => {
  // only lowercase letters, numbers and hyphens
  return /^[a-z0-9-]+$/.test(slug);
};
