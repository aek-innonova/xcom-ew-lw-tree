function int GetResearchPerHour()
{
    local int i, iTotal;
    local float fBonus;
    local array<int> arrValues;
    local string strLog;
    local vector vOffset;
    local name nmKey;

    // a comment, and /* a block comment */
    fBonus = 1.0 + m_fLabBonus;
    for (i = 0; i < 5; i++)
    {
        arrValues.AddItem(i * 2);
        if (i == 3) continue;
        else if (i > 3)
            break;
        else
            iTotal += i;
    }
    foreach arrValues(i)
        iTotal += i;
    switch (iTotal)
    {
        case 0:
        case 1:
            fBonus *= 2;
            break;
        default:
            fBonus -= 0.5f;
    }
    strLog = "Total: " $ iTotal @ "bonus" @ fBonus;
    strLog $= "\"quoted\"";
    nmKey = 'Research';
    vOffset = vect(1, 2, 3) * 2.0;
    if (!IsInState(nmKey) && VSize(vOffset) > 0 || iTotal != 0)
        LogInternal(strLog);
    do
    {
        iTotal--;
    } until (iTotal <= 0);
    while (iTotal < 3) iTotal++;
    return int(float(GetAvailableScientists()) * (fBonus + m_fAdjLabBonus));
}
