const api = (() => {
  async function req(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status, data: err });
    }
    return res.json();
  }

  return {
    // Entries
    getCurrentEntry:    ()       => req('GET',    '/api/entries/current'),
    getEntries:         (params) => req('GET',    '/api/entries' + (params ? '?' + new URLSearchParams(params) : '')),
    clockIn:            (data)   => req('POST',   '/api/entries', data),
    clockOut:           (id, d)  => req('POST',   `/api/entries/${id}/clockout`, d),
    updateEntry:        (id, d)  => req('PUT',    `/api/entries/${id}`, d),
    deleteEntry:        (id)     => req('DELETE', `/api/entries/${id}`),

    // Photos
    getPhotos:          (id)      => req('GET',    `/api/entries/${id}/photos`),
    uploadPhoto:        (id, d)   => req('POST',   `/api/entries/${id}/photos`, d),
    deletePhoto:        (id, pid) => req('DELETE', `/api/entries/${id}/photos/${pid}`),
    startBreak:         (id, d)  => req('POST',   `/api/entries/${id}/break/start`, d),
    endBreak:           (id, d)  => req('POST',   `/api/entries/${id}/break/end`, d),

    // Organizations
    getOrganizations:   ()       => req('GET',    '/api/organizations'),
    createOrganization: (d)      => req('POST',   '/api/organizations', d),
    updateOrganization: (id, d)  => req('PUT',    `/api/organizations/${id}`, d),
    deleteOrganization: (id)     => req('DELETE', `/api/organizations/${id}`),

    // Clients
    getClients:         ()       => req('GET',    '/api/clients'),
    createClient:       (d)      => req('POST',   '/api/clients', d),
    updateClient:       (id, d)  => req('PUT',    `/api/clients/${id}`, d),
    deleteClient:       (id)     => req('DELETE', `/api/clients/${id}`),

    // Pay Rates
    getPayRates:        ()       => req('GET',    '/api/pay-rates'),
    createPayRate:      (d)      => req('POST',   '/api/pay-rates', d),
    updatePayRate:      (id, d)  => req('PUT',    `/api/pay-rates/${id}`, d),
    deletePayRate:      (id)     => req('DELETE', `/api/pay-rates/${id}`),

    // Settings
    getSettings:        ()       => req('GET',    '/api/settings'),
    saveSettings:       (d)      => req('PUT',    '/api/settings', d),

    // Reports
    getWeekReport:      (date)   => req('GET',    '/api/reports/week' + (date ? `?date=${date}` : '')),
    getExportUrl:       (from, to) => `/api/reports/export/csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,

    // Pay Periods
    getPayPeriods:    ()  => req('GET',  '/api/pay-periods'),
    upsertPayPeriod:  (d) => req('POST', '/api/pay-periods', d),
  };
})();
