package org.fossify.calendar.helpers

import org.joda.time.DateTimeZone
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class ParserTest {
    private lateinit var originalTimeZone: DateTimeZone

    @Before
    fun setUp() {
        originalTimeZone = DateTimeZone.getDefault()
        DateTimeZone.setDefault(DateTimeZone.forID("America/New_York"))
    }

    @After
    fun tearDown() {
        DateTimeZone.setDefault(originalTimeZone)
    }

    @Test
    fun parsesZuluTimeAsAnAbsoluteInstant() {
        val timestamp = Parser().parseDateTimeValue("20261106T170000Z")

        assertEquals(1793984400L, timestamp)
        assertEquals(
            "2026-11-06T12:00:00.000-05:00",
            Formatter.getDateTimeFromTS(timestamp).toString()
        )
    }

    @Test
    fun parsesTzidTimeUsingTheEventZone() {
        val timestamp = Parser().parseDateTimeValue(
            "20261106T130000",
            DateTimeZone.forID("America/New_York")
        )

        assertEquals(1793988000L, timestamp)
    }
}
