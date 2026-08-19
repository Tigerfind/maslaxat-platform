function byButton(page, name) {
  return page.getByRole('button', { name });
}

function byField(page, label) {
  return page.getByLabel(label);
}

module.exports = { byButton, byField };
