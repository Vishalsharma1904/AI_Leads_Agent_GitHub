package ai.rudra24.mobile

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Android Keystore protects persistent sign-in tokens; leads stay in memory only.
class SessionStore(context: Context) {
    private val prefs=context.getSharedPreferences("rudra24.session",Context.MODE_PRIVATE)
    private val key: SecretKey get() {
        val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey("rudra24.session",null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("rudra24.session",KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun read(name: String): String? = try {
        prefs.getString(name,null)?.let { value ->
            val parts=value.split(":")
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP))) }
                .doFinal(Base64.decode(parts[1],Base64.NO_WRAP)).toString(Charsets.UTF_8)
        }
    } catch (_: Exception) { prefs.edit().remove(name).apply(); null }
    fun write(name: String,value: String?) {
        if(value==null){prefs.edit().remove(name).apply();return}
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE,key) }
        val encoded=Base64.encodeToString(cipher.iv,Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.toByteArray()),Base64.NO_WRAP)
        prefs.edit().putString(name,encoded).apply()
    }
}

data class Lead(val id:String,val company:String,val phone:String,val email:String,val address:String,val stage:String)
data class Job(val id:String,val label:String,val status:String,val type:String,val summary:String,val requestId:String="",val conversations:List<String> = emptyList())
data class Choice(val id:String,val label:String,val language:String="",val body:String="")
data class Review(val path:String,val payload:JSONObject,val destinations:List<String>,val content:String)
class ApiFailure(val statusCode:Int,message:String):Exception(message)
fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

class Workspace(application:Application):AndroidViewModel(application) {
    private val vault=SessionStore(application)
    private val preferences=application.getSharedPreferences("rudra24.settings",Context.MODE_PRIVATE)
    var base by mutableStateOf(preferences.getString("backend","")?:""); private set
    var session by mutableStateOf(vault.read("session")?.let { JSONObject(it) }); private set
    private var config=JSONObject().put("supabase_url",CloudConfig.supabaseUrl).put("supabase_publishable_key",CloudConfig.publishableKey)
    private val refreshLock=Mutex()
    private val oauthLock=Mutex()
    private var epoch=0
    private var activeQuery=""
    var page by mutableStateOf("Home")
    var channel by mutableStateOf("calls")
    var error by mutableStateOf(""); private set
    var busy by mutableStateOf(false); private set
    var leads by mutableStateOf(emptyList<Lead>()); private set
    var total by mutableStateOf(0); private set
    var jobs by mutableStateOf(emptyList<Job>()); private set
    var agents by mutableStateOf(emptyList<Choice>()); private set
    var phones by mutableStateOf(emptyList<Choice>()); private set
    var templates by mutableStateOf(emptyList<Choice>()); private set
    var selected by mutableStateOf(emptySet<String>())
    var detail by mutableStateOf<JSONObject?>(null)
    var callDetail by mutableStateOf<JSONObject?>(null)
    var control by mutableStateOf<JSONObject?>(null); private set
    private var lastControlRefresh=0L
    private val productSessionId=UUID.randomUUID().toString()
    private val productDeviceId=preferences.getString("product-device-id",null)?:UUID.randomUUID().toString().also{preferences.edit().putString("product-device-id",it).apply()}
    var providerStatus by mutableStateOf(""); private set
    private var leadRevision=""
    var review by mutableStateOf<Review?>(null)
    val email:String get()=session?.optJSONObject("user")?.optString("email")?:""
    private val owner:String get()=session?.optJSONObject("user")?.optString("id")?:""
    init { action { configure(); if(session!=null&&base.isNotBlank()) refresh() } }

    fun action(block:suspend ()->Unit) { if(busy)return; viewModelScope.launch {
        busy=true;error=""
        try { block() } catch(exception:CancellationException){throw exception}
        catch(exception:Exception){error=exception.message?:"Request unavailable. Check your connection."}
        finally{busy=false}
    } }
    private suspend fun http(url:String,method:String="GET",payload:JSONObject?=null,headers:Map<String,String> = emptyMap()):JSONObject=withContext(Dispatchers.IO) {
        val connection=URI(url).toURL().openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects=false;connection.requestMethod=method
            connection.connectTimeout=10000;connection.readTimeout=25000
            connection.setRequestProperty("Content-Type","application/json")
            headers.forEach{(name,value)->connection.setRequestProperty(name,value)}
            if(payload!=null){connection.doOutput=true;connection.outputStream.use { it.write(payload.toString().toByteArray()) }}
            val code=connection.responseCode
            val text=(if(code in 200..299)connection.inputStream else connection.errorStream)?.bufferedReader()?.use{it.readText()}?:"{}"
            val result=try{JSONObject(text)}catch(_:Exception){throw IllegalStateException("Backend returned an invalid response")}
            if(code !in 200..299)throw ApiFailure(code,result.optString("detail",result.optString("msg",result.optString("error_description","Request failed ($code)"))))
            result
        } finally { connection.disconnect() }
    }
    suspend fun configure() {
        config=if(base.isBlank())JSONObject().put("supabase_url",CloudConfig.supabaseUrl).put("supabase_publishable_key",CloudConfig.publishableKey) else http("$base/api/public-config")
        require(config.optString("supabase_url").startsWith("https://")&&config.optString("supabase_publishable_key").isNotBlank()) { "Backend sign-in configuration missing" }
    }
    private suspend fun auth(path:String,payload:JSONObject):JSONObject=http(config.getString("supabase_url")+"/auth/v1/"+path,"POST",payload,mapOf("apikey" to config.getString("supabase_publishable_key")))
    private fun storeSession(value:JSONObject) {
        require(value.optString("access_token").isNotBlank()&&value.optString("refresh_token").isNotBlank()&&!value.optJSONObject("user")?.optString("id").isNullOrBlank()){ "Sign-in session unavailable" }
        value.remove("provider_token");value.remove("provider_refresh_token")
        value.put("expires_at",System.currentTimeMillis()/1000+value.optLong("expires_in",3600));session=value;vault.write("session",value.toString())
    }
    private suspend fun token():String=refreshLock.withLock {
        val current=session?:throw IllegalStateException("Sign in first")
        if(System.currentTimeMillis()/1000>current.optLong("expires_at")-60) {
            val generation=epoch
            val refreshed=try{auth("token?grant_type=refresh_token",JSONObject().put("refresh_token",current.getString("refresh_token")))}catch(exception:ApiFailure){if(generation==epoch&&exception.statusCode in listOf(400,401,403))logout();throw exception}
            check(generation==epoch){"Account changed"};storeSession(refreshed)
        }
        session!!.getString("access_token")
    }
    private suspend fun api(path:String,payload:JSONObject?=null,method:String=if(payload==null)"GET" else "POST",idempotencyKey:String?=null):JSONObject {
        val generation=epoch
        val backend=base
        check(backend.isNotBlank()){ "Google sign-in connected. Leads aur outreach ke liye cloud API setup pending hai. More mein hosted HTTPS API connect kijiye." }
        val access=token()
        check(generation==epoch){"Account changed"}
        val headers=mutableMapOf("Authorization" to "Bearer $access")
        if(idempotencyKey!=null)headers["Idempotency-Key"]=idempotencyKey
        val data=try{http(backend+path,method,payload,headers)}
        catch(exception:ApiFailure){if(exception.statusCode==401&&generation==epoch)logout();throw exception}
        check(generation==epoch){"Account changed"};return data
    }
    private fun clearData(){control=null;lastControlRefresh=0L;epoch++;activeQuery="";leadRevision="";callDetail=null;providerStatus="";leads=emptyList();selected=emptySet();jobs=emptyList();agents=emptyList();phones=emptyList();templates=emptyList();detail=null;review=null;total=0}
    fun saveBackend(value:String)=action {
        if(value.isBlank()){base="";preferences.edit().remove("backend").apply();session=null;vault.write("session",null);vault.write("google-pkce",null);clearData();configure();return@action}
        val url=URI(value.trim());require(url.scheme=="https"&&!url.host.isNullOrBlank()&&url.userInfo==null&&url.query==null&&url.fragment==null&&(url.path.isNullOrEmpty()||url.path=="/")){"Use an HTTPS backend origin without a path"}
        base=value.trim().trimEnd('/');preferences.edit().putString("backend",base).apply()
        session=null;vault.write("session",null);vault.write("google-pkce",null);clearData();configure()
    }
    fun login(address:String,password:String)=action {
        configure();val result=auth("token?grant_type=password",JSONObject().put("email",address.trim()).put("password",password))
        clearData();storeSession(result);if(base.isNotBlank())refresh()
    }
    fun googleLogin(context:Context)=action {
        configure()
        val settings=http(config.getString("supabase_url")+"/auth/v1/settings",headers=mapOf("apikey" to config.getString("supabase_publishable_key")))
        check(settings.optJSONObject("external")?.optBoolean("google")==true){"Workspace owner ko Supabase mein Google provider enable karna hoga."}
        val bytes=ByteArray(32).also{SecureRandom().nextBytes(it)}
        val flags=Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
        val verifier=Base64.encodeToString(bytes,flags)
        val challenge=Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)),flags)
        vault.write("google-pkce",JSONObject().put("verifier",verifier).put("created",System.currentTimeMillis()).put("project",config.getString("supabase_url")).put("epoch",epoch).toString())
        val url=Uri.parse(config.getString("supabase_url")+"/auth/v1/authorize").buildUpon()
            .appendQueryParameter("provider","google").appendQueryParameter("redirect_to",CloudConfig.redirect)
            .appendQueryParameter("code_challenge",challenge).appendQueryParameter("code_challenge_method","s256")
            .appendQueryParameter("prompt","select_account").build()
        try{context.startActivity(Intent(Intent.ACTION_VIEW,url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))}
        catch(exception:Exception){vault.write("google-pkce",null);throw IllegalStateException("Google sign-in ke liye Chrome ya browser install kijiye.")}
    }
    fun handleGoogleCallback(uri:Uri?) {
        if(uri==null||uri.scheme!="ai.rudra24.mobile"||uri.host!="auth"||uri.path!="/callback")return
        viewModelScope.launch { oauthLock.withLock {
            while(busy)delay(50)
            busy=true;error=""
            val generation=epoch
            try {
                val pending=vault.read("google-pkce")?.let{JSONObject(it)}
                vault.write("google-pkce",null)
                check(uri.getQueryParameter("error")==null){"Google sign-in cancel hua. Dobara Continue with Google dabaiye."}
                require(pending!=null){"Google sign-in expired. Isi app se dobara shuru kijiye."}
                val age=System.currentTimeMillis()-pending.getLong("created")
                require(age in 0..600000&&pending.optString("verifier").matches(Regex("[A-Za-z0-9_-]{43}"))){"Google sign-in expired. Dobara shuru kijiye."}
                configure()
                require(pending.getString("project")==config.getString("supabase_url")){"Workspace changed. Dobara sign in kijiye."}
                val code=uri.getQueryParameter("code")?.takeIf{it.isNotBlank()}?:throw IllegalArgumentException("Google callback unavailable. Dobara sign in kijiye.")
                val result=auth("token?grant_type=pkce",JSONObject().put("auth_code",code).put("code_verifier",pending.getString("verifier")))
                check(generation==epoch){"Account changed"}
                clearData();storeSession(result);page="Home"
                if(base.isNotBlank())refresh()
            }catch(exception:CancellationException){throw exception}
            catch(exception:Exception){error=exception.message?:"Google sign-in unavailable"}
            finally{busy=false}
        } }
    }
    fun logout(){val old=session;val oldConfig=JSONObject(config.toString());session=null;vault.write("session",null);vault.write("google-pkce",null);clearData();error=""
        viewModelScope.launch { try{if(old!=null)http(oldConfig.getString("supabase_url")+"/auth/v1/logout?scope=local","POST",JSONObject(),mapOf("apikey" to oldConfig.getString("supabase_publishable_key"),"Authorization" to "Bearer ${old.optString("access_token")}"))}catch(_:Exception){} }
    }
    suspend fun loadLeads(append:Boolean=false,filter:String?=null) {
        if(filter!=null&&!append)activeQuery=filter
        val data=api("/api/crm/records?view=leads&limit=50&offset=${if(append)leads.size else 0}&search=${java.net.URLEncoder.encode(activeQuery,"UTF-8")}")
        val items=data.optJSONArray("records")?.objects()?.map { row->val p=row.getJSONObject("profile");Lead(row.getString("id"),p.optString("company"),p.optString("phone").ifBlank{p.optString("mobile")},p.optString("email"),p.optString("address"),row.optString("stage")) }?:emptyList()
        if(append)leads=(leads+items).distinctBy{it.id} else {leads=items;selected=emptySet()};total=data.optInt("total")
    }
    suspend fun loadJobs() {
        val generation=epoch
        val loaded=mutableListOf<Job>();val problems=mutableListOf<String>();var revision=leadRevision
        for((type,path,key) in listOf(Triple("lead","/api/v1/lead-jobs","jobs"),Triple("outreach","/api/v1/outreach-jobs","jobs"),Triple("call","/api/v1/elevenlabs/batch-calls","batch_calls"))) {
            try{val rows=api(path).optJSONArray(key)?.objects()?:emptyList()
                if(type=="lead")revision=rows.joinToString("|"){"${it.optString("id")}:${it.optInt("result_count")}:${it.optString("status")}"}
                rows.forEach { row ->
                val id=if(type=="call")row.optString("batch_id").takeUnless{it=="null"||it.isBlank()}?:row.optString("request_id") else row.getString("id")
                val items=row.optJSONArray("items")?.objects()?:emptyList()
                val recipients=row.optJSONArray("recipients")?.objects()?:emptyList()
                val summary=if(type=="lead")"${row.optInt("result_count")} leads · ${row.optString("stage")}" else if(type=="outreach")items.joinToString("\n"){"${it.optString("recipient")} · ${it.optString("status")}"} else recipients.joinToString("\n"){"${it.optString("phone_number")} · ${it.optString("status")}"}
                loaded.add(Job(id,if(type=="lead")"Lead search" else if(type=="outreach")row.optString("channel")+" batch" else row.optString("name","Calling batch"),row.optString("status"),type,summary,row.optString("request_id"),recipients.map{it.optString("conversation_id")}.filter{it.isNotBlank()&&it!="null"}.distinct()))
            }}catch(exception:CancellationException){throw exception}catch(exception:Exception){problems.add(exception.message?:"Status unavailable")}
        }
        if(generation!=epoch)return
        jobs=loaded
        if(revision!=leadRevision&&selected.isEmpty()){loadLeads();leadRevision=revision}
        val pending=vault.read("pending-$owner")?.let { JSONObject(it) }
        if(pending!=null&&jobs.any{it.requestId==pending.optJSONObject("payload")?.optString("request_id")})vault.write("pending-$owner",null)
        val searchPending=vault.read("lead-pending-$owner")
        if(searchPending!=null&&jobs.any{it.type=="lead"&&it.requestId==searchPending})vault.write("lead-pending-$owner",null)
        if(problems.isNotEmpty())error=problems.distinct().joinToString(" · ")
    }
    suspend fun refreshControl(force:Boolean=false) {
        if(session==null||base.isBlank())return
        if(!force&&System.currentTimeMillis()-lastControlRefresh<30000)return
        val generation=epoch
        val value=api("/api/control/me")
        if(generation!=epoch)return
        control=value;lastControlRefresh=System.currentTimeMillis()
        try{api("/api/insights/heartbeat",JSONObject().put("session_id",productSessionId).put("device_id",productDeviceId)
            .put("device_label","Android · "+android.os.Build.MODEL.take(60)).put("platform","Android")
            .put("region",java.time.ZoneId.systemDefault().id.take(80)).put("active",true))}catch(_:Exception){ /* Retry on next foreground refresh. */ }
    }
    fun acknowledgeDisclosure()=action {
        val version=control?.optJSONObject("disclosure")?.optString("version")?:return@action
        api("/api/control/disclosure",JSONObject().put("version",version).put("accepted",true))
        refreshControl(true)
    }
    suspend fun refresh(){refreshControl(true);loadLeads();loadJobs()}
    fun refreshAll()=action {if(session==null)configure() else refresh()}
    fun changeChannel(value:String){channel=value;action {
        if(value=="calls"){
            agents=api("/api/v1/elevenlabs/agents").optJSONArray("agents")?.objects()?.map{Choice(it.getString("agent_id"),it.optString("name"))}?:emptyList()
            phones=api("/api/v1/elevenlabs/phones").optJSONArray("phone_numbers")?.objects()?.map{Choice(it.getString("phone_number_id"),it.optString("label").ifBlank{it.optString("phone_number")})}?:emptyList()
        }
        if(value=="whatsapp")templates=api("/api/v1/whatsapp/templates").optJSONArray("templates")?.objects()?.map{row->Choice(row.getString("name"),row.getString("name"),row.optString("language"),row.optJSONArray("components")?.objects()?.firstOrNull{it.optString("type")=="BODY"}?.optString("text")?:"")}?:emptyList()
    }}
    fun search(city:String,industry:String,count:String)=action {
        check(vault.read("lead-pending-$owner")==null){"Previous search submission unresolved. Refresh job history first."}
        val n=count.toIntOrNull();require(n!=null&&n in 1..100&&city.isNotBlank()){ "City aur count 1–100 required" }
        selected=emptySet()
        val account=owner;val key=UUID.randomUUID().toString();vault.write("lead-pending-$account",key)
        try{api("/api/v1/lead-jobs",JSONObject().put("cities",JSONArray().put(city.trim())).put("industries",JSONArray().apply{if(industry.isNotBlank())put(industry.trim())}).put("count",n).put("sources",JSONArray(listOf("apify","maps"))),idempotencyKey=key)}
        catch(exception:ApiFailure){if(exception.statusCode in listOf(400,401,403,404,422,429))vault.write("lead-pending-$account",null);throw exception}
        vault.write("lead-pending-$account",null)
        loadJobs();page="Home"
    }
    fun leadDetail(id:String)=action {detail=api("/api/crm/records/$id")}
    fun toggle(id:String){selected=if(id in selected)selected-id else selected+id}
    fun prepare(limit:String,subject:String,message:String,agent:String,phone:String,template:Choice?,params:String,optIn:Boolean)=action {
        try{
            check(vault.read("pending-$owner")==null){"Previous submit unresolved. Refresh history before creating a new batch."}
            val n=limit.toIntOrNull();require(n!=null&&n in 1..200){"Limit must be 1–200"}
            val targets=leads.filter{it.id in selected}.take(n);require(targets.isNotEmpty()){ "Select leads first" }
            val destinations=targets.map{if(channel=="email")it.email else it.phone.trim().replace(Regex("[\\s().-]"),"")}
            val pattern=if(channel=="email")Regex("[^@\\s<>;,]+@[^@\\s<>;,]+\\.[^@\\s<>;,]+") else Regex("\\+[1-9][0-9]{7,14}")
            require(destinations.all{pattern.matches(it)}){"Each selected lead needs a valid email or +country-code phone"}
            require(destinations.map{it.lowercase()}.distinct().size==destinations.size){"Remove duplicate destinations"}
            val payload=JSONObject().put("request_id",UUID.randomUUID().toString()).put("confirmed",true)
            val content:String
            val path:String
            if(channel=="calls"){
                require(agent.isNotBlank()&&phone.isNotBlank()){ "Select agent and outbound number" }
                val readiness=api("/api/v1/elevenlabs/calling-readiness?agent_id=$agent&phone_number_id=$phone")
                require(readiness.optBoolean("ready")){readiness.optString("message","Calling setup incomplete")}
                payload.put("agent_id",agent).put("phone_number_id",phone).put("call_name","Rudra24 reviewed batch").put("recipients",JSONArray().apply{targets.zip(destinations).forEach{(lead,number)->put(JSONObject().put("phone_number",number).put("crm_record_id",lead.id))}})
                content="Agent: ${agents.find{it.id==agent}?.label}\nFrom: ${phones.find{it.id==phone}?.label}";path="/api/v1/elevenlabs/batch-calls"
            }else{
                payload.put("channel",channel).put("record_ids",JSONArray(targets.map{it.id}));path="/api/v1/outreach-jobs"
                if(channel=="email"){require(subject.isNotBlank()&&message.isNotBlank()){ "Subject and message required" };payload.put("subject",subject).put("message",message);content="$subject\n\n$message"}
                else{require(template!=null&&optIn){"Approved template and opt-in required"};payload.put("template",template.id).put("language",template.language).put("body_params",JSONArray(params.lines().filter{it.isNotBlank()})).put("opt_in",true);content="${template.id} (${template.language})\n${template.body}\n$params"}
            }
            review=Review(path,payload,targets.zip(destinations).map{(lead,destination)->"${lead.company} · $destination"},content)
        }catch(exception:Exception){error=exception.message?:"Review unavailable"}
    }
    fun submitReview(){val approved=review?:return;review=null;action {
        val account=owner;vault.write("pending-$account",JSONObject().put("path",approved.path).put("payload",approved.payload).toString())
        try{api(approved.path,approved.payload)}catch(exception:ApiFailure){
            if(exception.statusCode in listOf(400,403,404,422))vault.write("pending-$account",null)
            throw exception
        }
        vault.write("pending-$account",null);selected=emptySet();loadJobs()
    }}
    fun cancel(job:Job)=action {val prefix=when(job.type){"lead"->"/api/v1/lead-jobs/";"call"->"/api/v1/elevenlabs/batch-calls/";else->"/api/v1/outreach-jobs/"};api(prefix+job.id+"/cancel",JSONObject());loadJobs()}
    fun refreshJob(job:Job)=action {if(job.type=="call")api("/api/v1/elevenlabs/batch-calls/"+job.id);loadJobs()}
    fun showCall(id:String)=action {callDetail=api("/api/v1/elevenlabs/conversations/$id")}
    fun checkProviders()=action {
        val credentials=api("/api/credentials").optJSONArray("credentials")?.objects()?:emptyList()
        providerStatus=listOf("apify","groq","elevenlabs").joinToString("\n"){provider->
            provider.replaceFirstChar{it.uppercase()}+": "+if(credentials.any{it.optString("provider")==provider&&it.optBoolean("configured")})"configured" else "setup needed"
        }
    }
    fun report(message:String){error=message}
    fun saveContact(stage:String,phone:String,address:String)=action {
        val row=detail?:return@action
        api("/api/crm/records/${row.getString("id")}",JSONObject().put("version",row.getInt("version")).put("stage",stage).put("profile",JSONObject().put("phone",phone).put("email",address)),"PATCH")
        detail=api("/api/crm/records/${row.getString("id")}")
        val ids=selected;loadLeads();selected=ids.intersect(leads.map{it.id}.toSet())
    }
    fun addNote(note:String,key:String,onSaved:()->Unit)=action {
        val row=detail?:return@action;require(note.isNotBlank()){"Enter a note"}
        api("/api/crm/records/${row.getString("id")}/activities",JSONObject().put("kind","remark").put("note",note).put("idempotencyKey",key))
        detail=api("/api/crm/records/${row.getString("id")}");onSaved()
    }
    fun addFollowUp(title:String,due:String,onSaved:()->Unit)=action {
        val row=detail?:return@action;require(title.isNotBlank()){"Enter a follow-up title"}
        val body=JSONObject().put("recordId",row.getString("id")).put("title",title).put("kind","task")
        if(due.isNotBlank())body.put("dueAt",java.time.LocalDate.parse(due).toString())
        api("/api/crm/tasks",body);detail=api("/api/crm/records/${row.getString("id")}");onSaved()
    }
    fun finishFollowUp(task:JSONObject)=action {
        val row=detail?:return@action
        api("/api/crm/tasks/${task.getString("id")}",JSONObject().put("version",task.getInt("version")).put("status","completed"),"PATCH")
        detail=api("/api/crm/records/${row.getString("id")}")
    }
    fun csv():String=(listOf(listOf("Company","Phone","Email","Address","Stage"))+leads.map{listOf(it.company,it.phone,it.email,it.address,it.stage)}).joinToString("\r\n"){row->row.joinToString(","){value->"\""+(if(value.firstOrNull() in listOf('=','+','-','@'))"'$value" else value).replace("\"","\"\"")+"\""}}
}
