// No real event photography in the mock data yet (Organiser Console's
// FileDropzone lands in a later surface) — a category-keyed gradient stands
// in for the poster image everywhere one's shown, consistent everywhere.
const GRADIENTS = {
  Music: "linear-gradient(135deg, #4c2f9e, #7c5cff)",
  Conference: "linear-gradient(135deg, #1d2a52, #3e8bff)",
  Comedy: "linear-gradient(135deg, #8a4b1f, #e8a317)",
  Sports: "linear-gradient(135deg, #7a2d2d, #e5484d)",
  Arts: "linear-gradient(135deg, #1f5c4a, #00d4aa)",
};

export function categoryGradient(category) {
  return GRADIENTS[category] || "linear-gradient(135deg, #2a2a36, #4a4a58)";
}
