export async function getDrivingDistance(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
) {
  const res = await fetch(
    'https://api.openrouteservice.org/v2/directions/driving-car',
    {
      method: 'POST',
      headers: {
        Authorization: process.env.OPENROUTESERVICE_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      }),
    }
  )

  if (!res.ok) throw new Error('ORS failed')

  const json = await res.json()

  const summary = json.routes[0].summary

  return {
    distance_km: summary.distance / 1000,
    duration_min: summary.duration / 60,
  }
}