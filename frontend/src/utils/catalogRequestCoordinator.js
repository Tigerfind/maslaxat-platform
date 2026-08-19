function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
  }
  return value;
}

export function canonicalCatalogKey(value) {
  return JSON.stringify(stable(value));
}

export function createCatalogRequestCoordinator() {
  let generation = 0;
  let controller = null;
  return {
    begin(key) {
      controller?.abort();
      controller = new AbortController();
      generation += 1;
      return { key, generation, signal: controller.signal };
    },
    isCurrent(request) {
      return request.generation === generation && request.key && !request.signal.aborted;
    },
    cancel() { controller?.abort(); },
  };
}
