class UpkitModInfo extends Info
    config(Game);

var config int m_iSeed;
var UpkitModData m_kData;

event PostBeginPlay()
{
    super.PostBeginPlay();
    m_kData = new class'UpkitModData';
    m_kData.Init(m_iSeed);
}

function int Total()
{
    return m_kData.Sum() + m_iSeed;
}

defaultproperties
{
    m_iSeed=7
}
