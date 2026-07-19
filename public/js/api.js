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

    getEntryZipUrl:     (id)     => `/api/entries/${id}/export/zip?tz=${new Date().getTimezoneOffset()}`,

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

    // Projects
    getProjects:        ()       => req('GET',    '/api/projects'),
    createProject:      (d)      => req('POST',   '/api/projects', d),
    updateProject:      (id, d)  => req('PUT',    `/api/projects/${id}`, d),
    deleteProject:      (id)     => req('DELETE', `/api/projects/${id}`),

    // Planned jobs
    getPlannedJobs:     ()       => req('GET',    '/api/planned-jobs'),
    createPlannedJob:   (d)      => req('POST',   '/api/planned-jobs', d),
    updatePlannedJob:   (id, d)  => req('PUT',    `/api/planned-jobs/${id}`, d),
    deletePlannedJob:   (id)     => req('DELETE', `/api/planned-jobs/${id}`),

    // Settings
    getSettings:        ()       => req('GET',    '/api/settings'),
    saveSettings:       (d)      => req('PUT',    '/api/settings', d),

    // Reports
    getExportUrl:       (from, to) => `/api/reports/export/csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=${new Date().getTimezoneOffset()}`,

    // Pay Periods
    getPayPeriods:    ()  => req('GET',  '/api/pay-periods'),
    upsertPayPeriod:  (d) => req('POST', '/api/pay-periods', d),

    // Trips
    getTrips:            (params) => req('GET',    '/api/trips' + (params ? '?' + new URLSearchParams(params) : '')),
    getCurrentTrip:      ()       => req('GET',    '/api/trips/current'),
    startTrip:           (d)      => req('POST',   '/api/trips', d),
    stopTrip:            (id, d)  => req('POST',   `/api/trips/${id}/stop`, d),
    updateTrip:          (id, d)  => req('PUT',    `/api/trips/${id}`, d),
    deleteTrip:          (id)     => req('DELETE', `/api/trips/${id}`),
    getTripPhotos:       (id)     => req('GET',    `/api/trips/${id}/photos`),
    uploadTripPhoto:     (id, d)  => req('POST',   `/api/trips/${id}/photos`, d),

    startTripPause:      (id, d)  => req('POST',   `/api/trips/${id}/pause/start`, d),
    endTripPause:        (id, d)  => req('POST',   `/api/trips/${id}/pause/end`, d),

    reassignTrip:        (id, d)  => req('POST',   `/api/trips/${id}/reassign`, d),

    // Trip categories
    getTripCategories:   ()       => req('GET',    '/api/trip-categories'),

    getMileageExportUrl: (from, to) => `/api/reports/mileage/export/csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=${new Date().getTimezoneOffset()}`,
  };
})();
