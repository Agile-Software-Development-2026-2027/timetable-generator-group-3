% KAN-15/KAN-16 — ASP timetable: dynamic facts are supplied by facts.py.
% strict schedules all courses; partial schedules complete courses only.
scheduled(C) :- course(C,_), mode(strict).
{ scheduled(C) } :- course(C,_), mode(partial).

% Room eligibility: hard constraints on capacity, lab and projector requirements.
invalid_room(C,R) :- students(C,N), room(R,Capacity), N > Capacity.
invalid_room(C,R) :- requires_lab(C), room(R,_), not is_lab(R).
invalid_room(C,R) :- requires_projector(C), room(R,_), not has_projector(R).
eligible(C,R) :- course(C,_), room(R,_), not invalid_room(C,R).

% KAN-52: assign(C,R,D,S) is the START slot of one session of course C.
% Every selected course receives exactly N sessions, and a session may only
% start where its duration(C,B) blocks fit in the day (start_ok from facts.py).
N { assign(C,R,D,S) : eligible(C,R), start_ok(C,D,S) } N :-
    sessions(C,N), scheduled(C).

% A session occupies its room for every block from S to S+B-1.
occupies(C,R,D,S..S+B-1) :- assign(C,R,D,S), duration(C,B).

% Two sessions of the same course never overlap, in the same or another room.
:- assign(C,R1,D,S1), assign(C,R2,D,S2), (R1,S1) != (R2,S2),
   duration(C,B), S1 <= S2, S2 < S1 + B.

% All hard constraints below are written on occupies/4, so they hold for
% every block of a session, not only for its start.

% A room and a student group each have at most one session per block.
:- occupies(C1,R,D,S), occupies(C2,R,D,S), C1 < C2.
:- occupies(C1,_,D,S), occupies(C2,_,D,S), C1 < C2,
   group(C1,G), group(C2,G).

% KAN-53: leave enough travel time when a student group changes rooms.
% Slots are consecutive integers within each day. Same-room transitions
% do not require a buffer. This also covers two sessions of the same course.
:- occupies(C1,R1,D,S1), occupies(C2,R2,D,S2),
   group(C1,G), group(C2,G), R1 != R2,
   buffer_slots(B), S1 < S2, S2 - S1 <= B.

% Teachers may teach multiple courses but never simultaneously.
:- occupies(C1,_,D,S), occupies(C2,_,D,S), C1 < C2,
   teaches(T,C1), teaches(T,C2).

% Existing sessions outside the replacement scope are fixed reservations.
:- occupies(C,R,D,S), busy_room(R,D,S).
:- occupies(C,_,D,S), teaches(T,C), busy_teacher(T,D,S).
:- occupies(C,_,D,S), group(C,G), busy_group(G,D,S).

% Soft priorities, highest first:
%   @4 scheduling completeness (partial mode)
%   @3 spread a course's sessions over different days (KAN-55)
%   @2 teacher preferred slots (KAN-57)
%   @1 room fit (KAN-16)

% KAN-55 soft preference: spread a course's sessions over different days.
% same_day(C,D,S) is a session of C starting at S that is not the first one of
% C on day D, so a day with k sessions of C costs k-1. This makes 2+1+1 better
% than 3+1 when the sessions cannot all go on different days. It never blocks
% a solution: it only ranks the valid ones. starts/3 drops the room first, so
% the rule pairs start slots (slots^2 per course and day) instead of every
% room and slot combination (rooms^2 x slots^2).
starts(C,D,S) :- assign(C,_,D,S).
same_day(C,D,S2) :- starts(C,D,S1), starts(C,D,S2), S1 < S2.
#minimize { 1@3,C,D,S : same_day(C,D,S) }.

% KAN-16 soft preference: prefer the smallest eligible room that still fits the group.
% For each assignment, penalise by the room's capacity minus the number of enrolled
% students.  Priority @1 is the lowest, so the solver always prefers to schedule
% more courses, spread them and honour teacher preferences before tightening room fit.
wasted_seats(C,R,W) :- assign(C,R,_,_), students(C,N), room(R,Cap), W = Cap - N.
#minimize { W@1,C,R : wasted_seats(C,R,W) }.

% KAN-57 soft preference: use the blocks teachers marked as preferred.
% Written on occupies/4 (KAN-52) so every block of a session counts.
% Priority @2 sits below spreading sessions (@3) and above room fit (@1).
#maximize { 1@2,C,D,S : occupies(C,_,D,S), teaches(T,C), prefers_slot(T,D,S) }.

% Maximize fully scheduled hours when the strict model is infeasible.
% Priority @4 ensures scheduling completeness dominates every preference:
% spreading sessions or a teacher preference never makes the solver drop a course.
#maximize { H@4,C : scheduled(C), course(C,H), mode(partial) }.
#show assign/4.
#show scheduled/1.
