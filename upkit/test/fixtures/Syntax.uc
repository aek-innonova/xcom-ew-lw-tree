function int GetResearchPerHour()
{
    local array<int> A;
    local int I, J, Arr[4];
    local string S;
    local Vector V;
    local Rotator R;
    local name N;
    local float F;
    local bool B;
    local class<Actor> C;

    A.Length = 0;
    A.AddItem(5);
    A.Insert(0, 2);
    A.InsertItem(0, 7);
    A.RemoveItem(5);
    I = A.Find(7);
    A.Remove(0, 1);
    S = "abc";
    S $= "d";
    S @= "e";
    J = Len(S) + InStr(S, "b");
    S = Mid(S, 1, 2) $ Left(S, 1) $ Right(S, 1) $ Caps(S) $ Locs(S);
    S = Repl(S, "a", "b");
    if (S ~= "BCD") { J++; }
    switch (S)
    {
        case "x":
            J = 1;
            break;
        case "y":
            J = 2;
            break;
    }
    V.X = 1.0;
    V = V * 2;
    V += vect(1, 2, 3);
    F = VSize(V) ** 2.0;
    R.Yaw += 16384;
    N = 'Foo';
    if (N == 'Foo' && N != 'Bar') { J += 3; }
    S = string(N);
    N = name(S);
    Arr[2] = 1;
    J += ArrayCount(Arr);
    J = (J & 3) | (J << 2) ^ ~J;
    J = J % 3 + Abs(-J) + Min(J, 4) + Max(J, 1) + Clamp(J, 0, 9) + Rand(10);
    F = FMin(F, 1.0) + FRand() + 1e3;
    B = !B ^^ (J > 2);
    J = B ? (J > 1 ? 2 : 3) : 4;
    ++J;
    --J;
    I = int(F) + int(B);
    F = float(I);
    C = class'XGFacility_Labs';
    if (C != none && ClassIsChildOf(C, class'Actor') && IsA('XGFacility')) { J *= 2; }
    default.m_fLabBonus = 2.0;
    self.m_fAdjLabBonus = default.m_fLabBonus;
    return J;
}
