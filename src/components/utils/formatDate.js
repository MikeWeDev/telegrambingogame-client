const TZ = 'Africa/Addis_Ababa';

export function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-GB', {
        timeZone: TZ,
        day:      '2-digit',
        month:    'short',
        year:     'numeric',
    });
}

export function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('en-GB', {
        timeZone: TZ,
        hour:     '2-digit',
        minute:   '2-digit',
        hour12:   false,
    });
}

export function formatDateTime(iso) {
    return new Date(iso).toLocaleString('en-GB', {
        timeZone: TZ,
        day:      '2-digit',
        month:    'short',
        year:     'numeric',
        hour:     '2-digit',
        minute:   '2-digit',
        hour12:   false,
    });
}