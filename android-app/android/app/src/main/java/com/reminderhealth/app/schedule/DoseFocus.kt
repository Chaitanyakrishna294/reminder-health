package com.reminderhealth.app.schedule

/**
 * WHICH DOSE IS THE ALARM ASKING ABOUT RIGHT NOW.
 *
 * The coalesced ring shows every dose due at one instant, but only ONE of them is
 * active at a time: the focused dose rings, with big Taken / Skip; the rest sit
 * below it with their state visible. Answering advances the focus. So does
 * running out of time.
 *
 * Extracted from [AlarmActivity] because this is the part that can be wrong in a
 * way nobody sees: a dose quietly skipped in the rotation is a dose never asked
 * about, which looks exactly like a dose that was never due. An Activity cannot
 * be unit-tested; these three sets can.
 *
 * ## The states a dose can be in
 *
 *  - **focused** — ringing now, answerable now;
 *  - **waiting** — not yet asked; listed, and tappable to jump to;
 *  - **yielded** — its ring window expired without an answer. Still UNANSWERED:
 *    its retry ladder keeps running and it goes in the missed notice. It simply
 *    stops taking the screen's attention so the next dose can have it.
 *  - **answered** — Taken or Skip recorded, permanently out of the rotation.
 *
 * Yielded is the state that makes a handful work. Without it, a dose nobody
 * answers holds the screen forever and the other three are never asked; with it,
 * each dose gets one turn and the screen ends when every dose has had one.
 */
class DoseFocus {

    /** Stable presentation order — medication id, the one ordering every surface agrees on. */
    var order: List<Long> = emptyList()
        private set

    /** medicationId → the action recorded, or null when answered somewhere this screen did not see. */
    val answered = LinkedHashMap<Long, String?>()

    /** Doses whose ring window expired without an answer. NOT resolved — see the class doc. */
    val yielded = LinkedHashSet<Long>()

    var focused: Long? = null
        private set

    /**
     * Replace the known doses, keeping every decision already made.
     *
     * Called on the initial store read and again whenever a rung, another
     * medication's alarm, or an answer made elsewhere lands while the screen is
     * up. Merging rather than replacing is what lets a rung re-present the
     * handful without un-answering anything.
     */
    fun setOrder(ids: List<Long>) {
        order = ids
        // A dose that has left the store's unanswered set is answered; drop any
        // stale focus on it rather than ringing about a dose nobody is waiting for.
        if (focused != null && focused !in ids) focused = null
        yielded.retainAll(ids.toSet())
    }

    /**
     * Everything the screen still has to ask about — waiting or yielded, in order.
     * Yielded doses stay in the list precisely so they can be tapped back into
     * focus; missing your window is not meant to be a dead end.
     */
    fun outstanding(): List<Long> = order.filter { it !in answered }

    /** Doses that have neither been answered nor had their turn. */
    private fun unasked(): List<Long> = order.filter { it !in answered && it !in yielded }

    /**
     * Record an answer for [id] and hand the screen to the next dose.
     *
     * @return the new focus, or null when the handful is finished.
     */
    fun answer(id: Long, action: String): Long? {
        answered[id] = action
        yielded.remove(id)
        return advance()
    }

    /** Mark a dose answered elsewhere (notification, webview, caregiver sync). */
    fun answeredElsewhere(id: Long) {
        if (id in answered) return
        answered[id] = null
        yielded.remove(id)
        if (focused == id) focused = null
    }

    /**
     * The focused dose ran out of ring time. It yields — it is NOT resolved, and
     * nothing about its ladder or its place in the missed notice changes.
     *
     * @return the next dose to ring, or null when every dose has had its turn.
     */
    fun yieldFocus(): Long? {
        focused?.let { yielded.add(it) }
        focused = null
        return advance()
    }

    /**
     * The patient tapped a listed dose. Any order is allowed — a handful is not a
     * queue, and the one you can reach first is a perfectly good one to answer
     * first.
     *
     * Clears the yield, so a dose whose window expired gets a fresh one rather
     * than being tapped into a focus that immediately expires again.
     */
    fun focusOn(id: Long): Long? {
        if (id in answered || id !in order) return focused
        yielded.remove(id)
        focused = id
        return focused
    }

    /**
     * Give the screen to the first dose that has not yet had its turn.
     *
     * FIRST IN ORDER, not "the one after the current". Order is by medication id
     * and never changes, so the same handful always asks in the same sequence —
     * a list that reshuffles under a thumb between one answer and the next is how
     * someone taps Skip on the wrong medicine.
     */
    fun advance(): Long? {
        focused = unasked().firstOrNull()
        return focused
    }

    /**
     * Nothing left to ask about on this screen: every dose is either answered or
     * has had its turn. The caller closes.
     *
     * Note this is TRUE while doses are still outstanding — the yielded ones. They
     * are handled by the missed notice and by their own ladders, which is the
     * division of labour every other unattended path in this app already uses.
     */
    fun isFinished(): Boolean = focused == null && unasked().isEmpty()
}
