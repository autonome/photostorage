
const path = require("path");
const Flickr = require("flickr-sdk");
const fs = require("fs");

// Require the fastify framework and instantiate it
const fastify = require("fastify")({
  // Set this to true for detailed logging:
  logger: false
});

const fss = require('fastify-secure-session');

const k = Buffer.from(process.env.COOKIE_KEY, 'hex');

fastify.register(fss, {
  key: k,
  cookie: {
    secure: false,
    httpOnly: true
  }
});


fastify.addHook('preHandler', (request, reply, next) => {
  //console.log('handler')
  next();
});


// Setup our static files
fastify.register(require("fastify-static"), {
  root: path.join(__dirname, "public"),
  prefix: "/" // optional: default '/'
});

// fastify-formbody lets us parse incoming forms
fastify.register(require("fastify-formbody"));

// point-of-view is a templating manager for fastify
fastify.register(require("point-of-view"), {
  engine: {
    handlebars: require("handlebars")
  }
});

// Load and parse SEO data
const seo = require("./src/seo.json");
if (seo.url === "glitch-default") {
  seo.url = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
}

const oauth = new Flickr.OAuth(
  process.env.FLICKR_CONSUMER_KEY,
  process.env.FLICKR_CONSUMER_SECRET
);

// assigned in initialize()
let flickr = null;

const callbackURL = `https://${process.env.PROJECT_DOMAIN}.glitch.me/oauth`;

/**
* Initialize state data and Flickr login config
*
* 
*/
const initialize = async (session) => {
  try {
    //console.log('session', session)
    
    let state = session.get('state');
    if (!state) {
      state = {};
      session.set('state', state);
      session.set('loggedIn', false);
    }
    else {
      //console.log('user is logged in')
      flickr = new Flickr(Flickr.OAuth.createPlugin(
        process.env.FLICKR_CONSUMER_KEY,
        process.env.FLICKR_CONSUMER_SECRET,
        state.oauth_token,
        state.oauth_token_secret
      ));
    }
  }
  catch(ex) {
    console.log("/", ex)
  }
}


/**
* Our home page route
*
* Returns src/pages/index.hbs with data built into it
*/
fastify.get("/", async function(request, reply, next) {
  
  // params is an object we'll pass to our handlebars template
  let params = {
    seo: seo,
    loggedOut: true
  };
  
  const session = request.session;
  
  try {
    //console.log('session', session)
    
    await initialize(session);
    let state = session.get('state');
    let loggedIn = session.get('loggedIn');
    params.loggedOut = !loggedIn;
   
    if (loggedIn) {
      await flickrPump();
    }
  }
  catch(ex) {
    console.log("/", ex)
  }

  reply.view("/src/pages/index.hbs", params);
});

const flickrPump = async() => {
  // get list of sets
  const res = await flickr.photosets.getList();
  const photosets = res.body.photosets;
  console.log('photosets', Object.keys(res.body.photosets))
  
  console.log('cancreate', res.body.photosets.cancreate)
  console.log('page', res.body.photosets.page)
  console.log('pages', res.body.photosets.pages)
  console.log('perpage', res.body.photosets.perpage)
  console.log('total', res.body.photosets.total)
  
  // get list of set ids
  const setIds = photosets.photoset.map(set => set.id);
  //console.log('set ids', setIds)
}

/**
* Initiate a login to Flickr
*
* Redirects to Flickr Oauth login page
*/
fastify.get("/login", async function(request, reply, next) {
  try {
    //console.log('not logged in to flickr, initiating')
    let state = request.session.get('state');
    const res = await oauth.request(callbackURL);
    //console.log(res.body)
    const {oauth_token, oauth_token_secret} = res.body;
    
    state.oauth_token = oauth_token;
    state.oauth_token_secret = oauth_token_secret;
    request.session.set('state', state);
    
    const url = oauth.authorizeUrl(oauth_token);
    //console.log('authorized, redirecting')
    reply.redirect(url);
  }
  catch(ex) {
    console.log("/", ex)
  }
});

/**
* Logout of Flickr
*
* Redirects to homepage
*/
fastify.get("/logout", async function(request, reply, next) {
  try {
    //console.log('logging out of Flickr, deleting session')
    request.session.delete();
  }
  catch(ex) {
    console.log("error logging out", ex)
  }
  reply.redirect('/');
});

/**
* Flickr oauth redirect target
*
* Redirects back to homepage
*/
fastify.get("/oauth", async function(request, reply) {
  try {
    //console.log('oauth callback!');
    let state = request.session.get('state');
        
    state.oauth_token_verifier = request.query.oauth_verifier;

    let res = await oauth.verify(
      state.oauth_token,
      state.oauth_token_verifier,
      state.oauth_token_secret);
    //console.log('verified');

    state.fullname = res.body.fullname;
    state.oauth_token = res.body.oauth_token;
    state.oauth_token_secret = res.body.oauth_token_secret;
    state.user_nsid = res.body.user_nsid;
    state.username = res.body.username;

    request.session.set('loggedIn', true);
    request.session.set('state', state);
    //console.log('logged in, stored state')
    reply.redirect('/');
  }
  catch(ex) {
    reply.redirect('/error');
  }
});

/**
* Our POST route to handle and react to form submissions 
*
* Accepts body data indicating the user choice
*/
fastify.post("/", function(request, reply) {
  
  // Build the params object to pass to the template
  let params = { seo: seo };
  
  // If the user submitted a color through the form it'll be passed here in the request body
  let color = request.body.color;
  
  // If it's not empty, let's try to find the color
  if (color) {
    // ADD CODE FROM TODO HERE TO SAVE SUBMITTED FAVORITES
    
    // Load our color data file
    const colors = require("./src/colors.json");
    
    // Take our form submission, remove whitespace, and convert to lowercase
    color = color.toLowerCase().replace(/\s/g, "");
    
    // Now we see if that color is a key in our colors object
    if (colors[color]) {
      
      // Found one!
      params = {
        color: colors[color],
        colorError: null,
        seo: seo
      };
    } else {
      
      // No luck! Return the user value as the error property
      params = {
        colorError: request.body.color,
        seo: seo
      };
    }
  }
  
  // The Handlebars template will use the parameter values to update the page with the chosen color
  reply.view("/src/pages/index.hbs", params);
});

  
(async () => {
  try {
    // Run the server and report out to the logs
    await fastify.listen(process.env.PORT)
  }
  catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  //console.log(`Your app is listening on ${address}`);
  //fastify.log.info(`server listening on ${address}`);
})()
  
