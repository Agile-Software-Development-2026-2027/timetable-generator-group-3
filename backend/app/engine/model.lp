% KAN-15 — ASP timetable: dynamic facts are supplied by facts.py.
% strict schedules all courses; partial schedules complete courses only.
scheduled(C) :- course(C,_), mode(strict).
{ scheduled(C) } :- course(C,_), mode(partial).

invalid_room(C,R) :- students(C,N), room(R,Capacity), N > Capacity.
invalid_room(C,R) :- requires_lab(C), room(R,_), not is_lab(R).
invalid_room(C,R) :- requires_projector(C), room(R,_), not has_projector(R).
eligible(C,R) :- course(C,_), room(R,_), not invalid_room(C,R).

% Every selected course receives exactly H distinct blocks.
H { assign(C,R,D,S) : eligible(C,R), slot(D,S) } H :-
    course(C,H), scheduled(C).

% A room and a student group each have at most one session per block.
:- assign(C1,R,D,S), assign(C2,R,D,S), C1 < C2.
:- assign(C,R1,D,S), assign(C,R2,D,S), R1 < R2.
:- assign(C1,_,D,S), assign(C2,_,D,S), C1 < C2,
   group(C1,G), group(C2,G).

% Teachers may teach multiple courses but never simultaneously.
:- assign(C1,_,D,S), assign(C2,_,D,S), C1 < C2,
   teaches(T,C1), teaches(T,C2).

% Existing sessions outside the replacement scope are fixed reservations.
:- assign(C,R,D,S), busy_room(R,D,S).
:- assign(C,_,D,S), teaches(T,C), busy_teacher(T,D,S).
:- assign(C,_,D,S), group(C,G), busy_group(G,D,S).

% Maximize fully scheduled hours when the strict model is infeasible.
#maximize { H@1,C : scheduled(C), course(C,H), mode(partial) }.
#show assign/4.
#show scheduled/1.
