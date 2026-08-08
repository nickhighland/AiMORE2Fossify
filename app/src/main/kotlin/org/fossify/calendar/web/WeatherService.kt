package org.fossify.calendar.web

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URLEncoder
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.Locale

/**
 * Small, keyless weather client for the wall display. Open-Meteo supplies the
 * forecast and CAMS U.S. AQI; the result is kept in memory for 15 minutes so
 * the wall page can poll without repeatedly contacting the public APIs.
 */
object WeatherService {
    private const val CACHE_MAX_AGE_MS = 15 * 60 * 1000L

    private data class Cached(val zip: String, val fetchedAt: Long, val json: String)

    @Volatile
    private var cache: Cached? = null

    @Synchronized
    fun get(zipInput: String, labelInput: String): JSONObject {
        val zip = zipInput.trim()
        require(zip.length in 2..16) { "Enter a valid ZIP or postal code" }
        val label = labelInput.trim().take(120)
        val now = System.currentTimeMillis()
        val existing = cache
        if (existing != null && existing.zip == zip && now - existing.fetchedAt < CACHE_MAX_AGE_MS) {
            return JSONObject(existing.json).apply {
                put("label", label.ifBlank { getString("locationName") })
                put("updatedAt", existing.fetchedAt / 1000L)
            }
        }

        val location = geocode(zip)
        val forecast = request(
            "https://api.open-meteo.com/v1/forecast" +
                "?latitude=${location.latitude}&longitude=${location.longitude}" +
                "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m" +
                "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
                "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=3"
        )
        val airQuality = runCatching {
            request(
                "https://air-quality-api.open-meteo.com/v1/air-quality" +
                    "?latitude=${location.latitude}&longitude=${location.longitude}" +
                    "&current=us_aqi&timezone=auto"
            )
        }.getOrNull()

        val daily = forecast.optJSONObject("daily")
            ?: throw IllegalStateException("Weather forecast did not include daily data")
        val current = forecast.optJSONObject("current")
            ?: throw IllegalStateException("Weather forecast did not include current data")
        val dates = daily.optJSONArray("time") ?: JSONArray()
        val codes = daily.optJSONArray("weather_code") ?: JSONArray()
        val highs = daily.optJSONArray("temperature_2m_max") ?: JSONArray()
        val lows = daily.optJSONArray("temperature_2m_min") ?: JSONArray()
        val precipitation = daily.optJSONArray("precipitation_probability_max") ?: JSONArray()
        val sunrises = daily.optJSONArray("sunrise") ?: JSONArray()
        val sunsets = daily.optJSONArray("sunset") ?: JSONArray()
        val todayCode = number(codes, 0).toInt()
        val todayPrecipitation = number(precipitation, 0).toInt()
        val payload = JSONObject().apply {
            put("configured", true)
            put("zip", zip)
            put("label", label)
            put("locationName", location.displayName)
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            put("current", JSONObject().apply {
                put("temperature", number(current, "temperature_2m"))
                put("feelsLike", number(current, "apparent_temperature"))
                put("humidity", number(current, "relative_humidity_2m").toInt())
                put("precipitation", todayPrecipitation)
                put("weatherCode", todayCode)
                put("condition", condition(todayCode))
                put("windSpeed", number(current, "wind_speed_10m"))
                put("windDirection", cardinal(number(current, "wind_direction_10m")))
            })
            put("today", JSONObject().apply {
                put("high", number(highs, 0))
                put("low", number(lows, 0))
                put("precipitation", todayPrecipitation)
                put("sunrise", formatTime(string(sunrises, 0)))
                put("sunset", formatTime(string(sunsets, 0)))
                put("weatherCode", todayCode)
            })
            put("forecast", JSONArray().apply {
                for (index in 0 until minOf(3, dates.length())) {
                    val code = number(codes, index).toInt()
                    put(JSONObject().apply {
                        put("date", dayName(string(dates, index)))
                        put("high", number(highs, index))
                        put("low", number(lows, index))
                        put("precipitation", number(precipitation, index).toInt())
                        put("weatherCode", code)
                        put("condition", condition(code))
                    })
                }
            })
            put("airQuality", JSONObject().apply {
                val aqi = airQuality?.optJSONObject("current")?.let { numberOrNull(it, "us_aqi") }
                if (aqi == null) put("aqi", JSONObject.NULL) else {
                    put("aqi", aqi.toInt())
                    put("label", aqiLabel(aqi))
                }
            })
            put("locationName", location.displayName)
            put("updatedAt", now / 1000L)
        }
        cache = Cached(zip, now, payload.toString())
        return payload
    }

    private data class Location(val latitude: Double, val longitude: Double, val displayName: String)

    private fun geocode(zip: String): Location {
        val encoded = URLEncoder.encode(zip, StandardCharsets.UTF_8.toString())
        val response = request(
            "https://geocoding-api.open-meteo.com/v1/search?name=$encoded&count=1&language=en&format=json&countryCode=US"
        )
        val result = response.optJSONArray("results")?.optJSONObject(0)
            ?: throw IllegalArgumentException("ZIP code was not found")
        val city = result.optString("name").takeIf { it.isNotBlank() }
        val state = result.optString("admin1").takeIf { it.isNotBlank() }
        val display = listOfNotNull(city, state).joinToString(", ").ifBlank { zip }
        return Location(result.optDouble("latitude"), result.optDouble("longitude"), display)
    }

    private fun request(urlValue: String): JSONObject {
        val connection = (URL(urlValue).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 15_000
            setRequestProperty("Accept", "application/json")
        }
        try {
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.use { input ->
                BufferedReader(InputStreamReader(input, StandardCharsets.UTF_8)).readText()
            }.orEmpty()
            if (code !in 200..299) {
                val reason = runCatching { JSONObject(body).optString("reason") }.getOrNull()
                throw IllegalStateException(reason?.ifBlank { null } ?: "Weather service returned HTTP $code")
            }
            return JSONObject(body)
        } finally {
            connection.disconnect()
        }
    }

    private fun number(json: JSONObject, key: String): Double =
        if (json.has(key) && !json.isNull(key)) json.optDouble(key, 0.0) else 0.0

    private fun numberOrNull(json: JSONObject, key: String): Double? =
        if (json.has(key) && !json.isNull(key)) json.optDouble(key).takeUnless { it.isNaN() } else null

    private fun number(array: JSONArray, index: Int): Double =
        if (index in 0 until array.length() && !array.isNull(index)) array.optDouble(index, 0.0) else 0.0

    private fun string(array: JSONArray, index: Int): String =
        if (index in 0 until array.length() && !array.isNull(index)) array.optString(index) else ""

    private fun condition(code: Int): String = when (code) {
        0 -> "Clear"
        1, 2, 3 -> "Partly cloudy"
        45, 48 -> "Foggy"
        51, 53, 55, 56, 57 -> "Drizzle"
        61, 63, 65, 66, 67, 80, 81, 82 -> "Rain"
        71, 73, 75, 77, 85, 86 -> "Snow"
        95, 96, 99 -> "Thunderstorms"
        else -> "Cloudy"
    }

    private fun cardinal(degrees: Double): String {
        val directions = arrayOf("N", "NE", "E", "SE", "S", "SW", "W", "NW")
        val index = ((degrees + 22.5) / 45.0).toInt().mod(8)
        return directions[index]
    }

    private fun aqiLabel(aqi: Double): String = when {
        aqi <= 50 -> "Good"
        aqi <= 100 -> "Moderate"
        aqi <= 150 -> "Unhealthy for sensitive groups"
        aqi <= 200 -> "Unhealthy"
        aqi <= 300 -> "Very unhealthy"
        else -> "Hazardous"
    }

    private fun dayName(value: String): String = runCatching {
        java.time.LocalDate.parse(value).dayOfWeek.getDisplayName(java.time.format.TextStyle.SHORT, Locale.getDefault())
    }.getOrDefault(value)

    private fun formatTime(value: String): String = runCatching {
        val time = value.substringAfter('T').take(5).split(":")
        val hour = time[0].toInt()
        val minute = time[1]
        val suffix = if (hour >= 12) "PM" else "AM"
        val displayHour = when (val twelve = hour % 12) { 0 -> 12 else -> twelve }
        "$displayHour:$minute $suffix"
    }.getOrDefault(value)
}
