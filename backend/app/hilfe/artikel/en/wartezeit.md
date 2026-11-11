---
titel: How Dranzeit calculates the waiting time
kurz: Where the “approx.” time comes from, why each person has their own queue and what happens when a customer takes longer.
stichworte: waiting time, wait, calculation, time, approx, approximately, duration, preparation and clean-up, setup time, buffer, order, delay, running late, behind, longer, finished early
quelle: 2729e8abbe92
---
Dranzeit plans every customer like a small appointment: service, duration, next free slot with the person. That gives the time your customer sees on their number. If today goes differently than planned, Dranzeit recalculates using the current state at the front desk. Dranzeit doesn't work with averages.

## How the time is worked out

1. Every service has a **duration** and, optionally, **preparation and clean-up**, for example 25 minutes for a haircut plus 5 minutes for sweeping up. Both together are reserved for the customer.
2. Dranzeit looks for the earliest slot with the person that this time fits into completely: within the opening hours and their working hours, not in a break, not on top of another customer.
3. Slots always start on the quarter hour, so at :00, :15, :30 or :45.
4. With **“Anyone”**, Dranzeit picks the person who's free first.

Example: Anna has a haircut at 10:00 with 25 + 5 minutes. The next customer with her gets 10:30.

## Each person has their own queue

For each person, numbers and appointments are in one shared queue, sorted by time, not by who took a number first. If a short service still fits into a gap before an appointment, a customer who took a number later can therefore be served earlier. If Anna is very busy and Ben isn't, the wait with Ben is shorter. That's why customers see the next free slot for each person when taking a number.

## Why “approx.”?

The time is a plan. As soon as you've called someone for a person today, Dranzeit keeps recalculating it: whoever is being served needs as long as planned from the moment they were called, and the people waiting follow one after another.

- **A customer takes longer:** the times of the people waiting move along with it. The number page and the waiting-room display then show, for example, “approx. 10:45” instead of 10:30, and the front desk shows “approx. 15 min delay”. Customers with a fixed appointment see a notice that things are taking a little longer right now. Anyone waiting stays in the queue until you call or cancel them.
- **A customer finishes early:** just call the next number. The people waiting still never see an earlier time than the one they were given. The rest of the finished customer's time is free again: new numbers can get it, and [Earlier slot](/hilfe/frueher-dran) offers it.
- **New numbers:** if you're running behind, a new number goes after the people waiting, not at a time that has already been overtaken.
- **Always late or always gaps?** Then the duration isn't right. Adjust it under [Services](/hilfe/leistungen) or plan in preparation and clean-up.

Dranzeit doesn't show small deviations under 5 minutes; larger ones are rounded to 5 minutes. If you don't call anyone at all on a day, the planned times simply apply.

> **Tip:** “You're up soon” also follows the recalculated time. Cancel customers who don't turn up, otherwise Dranzeit keeps counting them. More on this: [Call customers and mark them as done](/hilfe/aufrufen), [Which messages your customers get](/hilfe/benachrichtigungen).
