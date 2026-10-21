class UpkitModData extends Object;

var array<int> m_arrValues;
var string m_strName;

function Init(int iSeed)
{
    local int I;

    I = 0;
    while (I < iSeed)
    {
        m_arrValues.AddItem(I * 2);
        ++I;
    }
    m_strName = "upkit";
}

function int Sum()
{
    local int I, iTotal;

    foreach m_arrValues(I)
    {
        iTotal += I;
    }
    return iTotal;
}

defaultproperties
{
    m_strName="none yet"
}
