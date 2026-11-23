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

% KAN-16 soft preference: prefer the smallest eligible room that still fits the group.
% For each assignment, penalise by the room's capacity minus the number of enrolled
% students.  Priority @1 is lower than the scheduling maximisation (@2), so the solver
% always prefers to schedule more courses before trying to tighten room fit.
wasted_seats(C,R,W) :- assign(C,R,_,_), students(C,N), room(R,Cap), W = Cap - N.
#minimize { W@1,C,R : wasted_seats(C,R,W) }.

% Maximize fully scheduled hours when the strict model is infeasible.
% Priority @2 ensures scheduling completeness dominates room preference.
#maximize { H@2,C : scheduled(C), course(C,H), mode(partial) }.
#show assign/4.
#show scheduled/1.
